import { performance } from "node:perf_hooks";
import { and, eq, inArray, sql } from "drizzle-orm";
import { sendJitter } from "@/lib/campaign-rate";
import type { Db, Executor } from "@/server/db/client";
import { accountSendControls, campaigns, campaignDeliveries, campaignParticipants, commentEvents, conversationStates, dmJobs, igAccounts, messageEvents, privateReplyClaims, sendAttempts, sendBuckets, type Campaign, type CampaignParticipant, type CommentEvent, type DmJob, type SendAttempt } from "@/server/db/schema";
import type { GraphClient, PrivateReplyMessage } from "@/server/instagram/graph";
import { SendDeferredError, SendRejectedError, SendUncertainError } from "@/server/queue/send-errors";
import { backoffDelayMs } from "@/server/queue/backoff";
import { CampaignError, campaignsEnabled, requireCampaignFeature } from "./access";
import { acquireSendPermit, databaseNow, observeRateHint, recordSendHealth, releaseSendLease, sendPolicy, type SendPolicy } from "./send-budget";
import { invokeBudgetedWrite, type BudgetedWriteResult } from "./send-call";
import { effectiveCampaignState } from "./state";
import { legacySendGuard } from "./legacy-guard";
import { checkCampaignFollower, type FollowDecision } from "./follow-profile";

export interface RenderContext { job: DmJob; campaign: Campaign; participant: CampaignParticipant; event: CommentEvent | null }
export interface DispatchDeps {
  db: Db; graph: GraphClient; decryptToken: (value: string) => string; random: () => number;
  render: (db: Executor, context: RenderContext) => Promise<PrivateReplyMessage | null>;
  /** Production uses DB time. Tests inject virtual time without waiting seven hours. */
  clock?: (db: Executor) => Promise<Date>;
}
interface Prepared {
  job: DmJob; attempt: SendAttempt; policy: SendPolicy; token: string; igUserId: string; recipientId: string;
  commentId: string | null; payload: PrivateReplyMessage; permitClockStarted: number;
}
export type SendResult = BudgetedWriteResult;

function fence(job: DmJob) { return and(eq(dmJobs.id, job.id), eq(dmJobs.leaseVersion, job.leaseVersion), eq(dmJobs.leaseOwner, job.leaseOwner!)); }

async function finishWithoutSend(db: Executor, job: DmJob, status: "waiting" | "held" | "canceled" | "expired" | "failed" | "unknown", now: Date, code: string, nextAt = now) {
  await db.update(dmJobs).set({ status, nextAttemptAt: nextAt, leaseOwner: null, leaseUntil: null, lastErrorCode: code, completedAt: ["waiting", "held"].includes(status) ? null : now }).where(fence(job));
  if (job.leaseOwner) await releaseSendLease(db, job.igAccountId, job.channel, job.leaseOwner);
}

/** Campaign -> job -> channel locks. Claim uses SKIP LOCKED and never waits for job locks. */
export async function prepareCampaignSend(deps: DispatchDeps, leased: DmJob, follow?: { decision: FollowDecision; checkedAt: Date; version: number }): Promise<Prepared | string> {
  const [mode] = await deps.db.select({ enabled: accountSendControls.lastObservedEnabled }).from(accountSendControls).where(eq(accountSendControls.igAccountId, leased.igAccountId));
  // A campaign may be the first write after reactivation; do not rely on another legacy event to warm up.
  if (mode && !mode.enabled) await legacySendGuard(deps.db, leased.igAccountId, await (deps.clock ?? databaseNow)(deps.db));
  const policy = await sendPolicy(deps.db);
  return deps.db.transaction(async (tx) => {
    const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, leased.campaignId)).for("update");
    const [context] = await tx.select({ job: dmJobs, account: igAccounts, participant: campaignParticipants, event: commentEvents, claim: privateReplyClaims }).from(dmJobs)
      .innerJoin(igAccounts, eq(igAccounts.id, dmJobs.igAccountId))
      .innerJoin(campaignParticipants, eq(campaignParticipants.id, dmJobs.participantId))
      .leftJoin(commentEvents, eq(commentEvents.id, dmJobs.sourceEventId))
      .leftJoin(privateReplyClaims, eq(privateReplyClaims.commentId, commentEvents.commentId))
      .where(and(fence(leased), eq(dmJobs.status, "leased"))).for("update", { of: dmJobs });
    const job = context?.job;
    if (!campaign || !job) return "stale_lease";
    const { account, participant, event, claim } = context;
    const now = await (deps.clock ?? databaseNow)(tx);
    if (!job.leaseUntil || job.leaseUntil <= now) return "stale_lease";
    if (job.nextAttemptAt > now) {
      await finishWithoutSend(tx, job, "waiting", now, "not_due", job.nextAttemptAt); return "waiting";
    }
    if (!await campaignsEnabled(tx, job.igAccountId)) {
      await finishWithoutSend(tx, job, "waiting", now, "feature_disabled"); return "held";
    }
    if (!account?.accessTokenEnc || account.status !== "active") {
      await finishWithoutSend(tx, job, "waiting", now, "account_inactive", new Date(now.getTime() + 60_000)); return "held";
    }
    try {
      if (campaign.followOnly || ["follow_link", "follow_reminder", "follow_request"].includes(job.kind)) await requireCampaignFeature(tx, campaign.userId, "campaign.follow_gate");
      if (["opening_link", "expiry_fallback"].includes(job.kind) || (job.channel === "private_reply" && event?.matchedRule === "notification")) await requireCampaignFeature(tx, campaign.userId, "campaign.scheduled_dm");
    } catch (error) {
      if (!(error instanceof CampaignError) || error.code !== "entitlement") throw error;
      await finishWithoutSend(tx, job, "held", now, "entitlement"); return "held";
    }
    const state = effectiveCampaignState(campaign, now);
    if (campaign.archivedAt || state === "settled" || (["closed", "sold_out"].includes(state) && job.kind !== "closed_notice")) {
      await finishWithoutSend(tx, job, "canceled", now, "campaign_closed"); return "canceled";
    }
    if (job.hardExpiresAt <= now) {
      await finishWithoutSend(tx, job, "expired", now, "hard_deadline_passed"); return "expired";
    }
    if (job.deadlineAt <= now) {
      if (job.channel === "private_reply" && ["opening_link", "expiry_fallback"].includes(job.kind) && campaign.expiryFallbackEnabled) {
        job.kind = "expiry_fallback";
        await tx.update(dmJobs).set({ kind: job.kind }).where(fence(job));
      } else {
        await finishWithoutSend(tx, job, "expired", now, "deadline_passed"); return "expired";
      }
    }
    if (job.kind === "opening_link" && state !== "open") {
      await finishWithoutSend(tx, job, "waiting", now, "waiting_for_open", new Date(Math.min(campaign.openAt.getTime(), job.deadlineAt.getTime()))); return "waiting";
    }
    if (["instant_link", "follow_request", "follow_link"].includes(job.kind) && state !== "open") {
      await finishWithoutSend(tx, job, "canceled", now, "campaign_not_open"); return "canceled";
    }
    if (!participant || (job.channel !== "message" && !event)) {
      await finishWithoutSend(tx, job, "failed", now, "missing_recipient"); return "failed";
    }
    if (job.channel === "private_reply") {
      if (claim?.jobId !== job.id || claim.state !== "reserved") {
        await finishWithoutSend(tx, job, "unknown", now, "private_reply_claim_unavailable"); return "unknown";
      }
    }
    if (job.channel === "message") {
      const [conversation] = await tx.select().from(conversationStates).where(and(eq(conversationStates.igAccountId, job.igAccountId), eq(conversationStates.senderId, participant.commenterIgId)));
      if (!conversation?.lastUserInteractionAt || conversation.lastUserInteractionAt > now || conversation.lastUserInteractionAt.getTime() + (policy.message_window_seconds - policy.message_safety_seconds) * 1000 <= now.getTime()) {
        await finishWithoutSend(tx, job, "expired", now, "message_window_closed"); return "expired";
      }
      const [source] = job.sourceMessageEventId ? await tx.select().from(messageEvents).where(and(eq(messageEvents.id, job.sourceMessageEventId), eq(messageEvents.igAccountId, job.igAccountId), eq(messageEvents.peerId, participant.commenterIgId))) : [];
      // A fresh unrelated conversation cannot revive a stale or deleted source response.
      if (!source || source.deletedAt || !source.occurredAt || source.occurredAt > now || !["message", "postback"].includes(source.kind) || (source.kind === "message" && !source.userMessageEvidence) || source.occurredAt.getTime() + (policy.message_window_seconds - policy.message_safety_seconds) * 1000 <= now.getTime()) {
        await finishWithoutSend(tx, job, "expired", now, "source_message_unavailable"); return "expired";
      }
      const anchor = Math.min(source.occurredAt.getTime(), conversation.lastUserInteractionAt.getTime());
      job.deadlineAt = new Date(Math.min(job.deadlineAt.getTime(), anchor + (policy.message_window_seconds - policy.message_safety_seconds) * 1000));
      job.hardExpiresAt = new Date(Math.min(job.hardExpiresAt.getTime(), anchor + policy.message_window_seconds * 1000));
      await tx.update(dmJobs).set({ deadlineAt: job.deadlineAt, hardExpiresAt: job.hardExpiresAt }).where(fence(job));
      if (conversation.automationPausedUntil && conversation.automationPausedUntil > now) {
        await finishWithoutSend(tx, job, "waiting", now, "human_handoff", conversation.automationPausedUntil); return "held";
      }
    }
    if (!job.jitterUntil) {
      job.jitterUntil = new Date(Math.max(job.scheduledAt.getTime(), Math.min(now.getTime(), job.nextAttemptAt.getTime())) + sendJitter(policy.jitter_min_ms, policy.jitter_max_ms, deps.random));
      // Expiry fallback may be due before the advertised opening time.
      if (job.kind === "expiry_fallback") job.jitterUntil = new Date(now.getTime() + sendJitter(policy.jitter_min_ms, policy.jitter_max_ms, deps.random));
      await tx.update(dmJobs).set({ jitterUntil: job.jitterUntil }).where(fence(job));
    }
    if (job.jitterUntil > now) {
      await finishWithoutSend(tx, job, "waiting", now, "jitter", job.jitterUntil);
      await tx.update(sendBuckets).set({ nextEligibleAt: sql`greatest(${sendBuckets.nextEligibleAt}, ${job.jitterUntil.toISOString()}::timestamptz)` }).where(and(eq(sendBuckets.igAccountId, job.igAccountId), eq(sendBuckets.channel, job.channel)));
      return "waiting";
    }
    // A comment alone does not authorize a profile lookup. Reuse only a recent lookup made outside this transaction.
    if (campaign.followOnly && job.channel === "private_reply" && ["opening_link", "instant_link"].includes(job.kind)) {
      const decision = follow && follow.version === campaign.version && follow.checkedAt <= now && now.getTime() - follow.checkedAt.getTime() <= policy.dispatch_lease_seconds * 1000 ? follow.decision : null;
      if (decision?.kind === "retry") {
        const attempts = job.followCheckAttempts + (decision.code === "api_cooldown" ? 0 : 1);
        await tx.update(dmJobs).set({ followCheckAttempts: attempts }).where(fence(job));
        await finishWithoutSend(tx, job, attempts >= policy.max_attempts ? "failed" : "waiting", now, decision.code, decision.nextAt);
        return attempts >= policy.max_attempts ? "failed" : "waiting";
      }
      if (decision?.kind === "blocked") { await finishWithoutSend(tx, job, "held", now, decision.code); return "held"; }
      const [consent] = decision && ["following", "fail_open"].includes(decision.kind) ? await tx.select({ at: conversationStates.consentAt }).from(conversationStates).where(and(eq(conversationStates.igAccountId, job.igAccountId), eq(conversationStates.senderId, participant.commenterIgId))) : [];
      if (!decision || !["following", "fail_open"].includes(decision.kind) || !consent?.at || consent.at > now) {
        job.kind = "follow_request";
        await tx.update(dmJobs).set({ kind: job.kind }).where(fence(job));
      }
    }
    const payload = await deps.render(tx, { job, campaign, participant, event: event ?? null });
    if (!payload) { await finishWithoutSend(tx, job, "canceled", now, "empty_template"); return "canceled"; }
    const token = deps.decryptToken(account.accessTokenEnc); // A decryption error cannot have sent anything.
    // Start the monotonic budget BEFORE reading the database clock; include query/commit delay.
    const permitClockStarted = performance.now();
    const permitAt = await (deps.clock ?? databaseNow)(tx);
    try {
      const permit = await acquireSendPermit(tx, { igAccountId: job.igAccountId, channel: job.channel, campaignId: campaign.id, campaignRate: campaign.hourlyRate,
        jobId: job.id, sourceMessageEventId: job.sourceMessageEventId ?? undefined, logicalKey: job.idempotencyKey, leaseOwner: job.leaseOwner!, leaseVersion: job.leaseVersion, payload, now: permitAt, extendSafety: true }, policy, deps.random);
      if (permit.cached) { await finishWithoutSend(tx, job, "unknown", now, "accepted_attempt_requires_reconciliation"); return "unknown"; }
      const [sending] = await tx.update(dmJobs).set({ status: "sending", attempts: sql`${dmJobs.attempts} + 1`, templateRevisionUsed: campaign.version,
        leaseUntil: new Date(permitAt.getTime() + policy.dispatch_lease_seconds * 1000) }).where(fence(job)).returning();
      return { job: sending, attempt: permit.attempt, policy, token, igUserId: account.igUserId, recipientId: participant.commenterIgId, commentId: event?.commentId ?? null, payload, permitClockStarted };
    } catch (error) {
      if (error instanceof SendDeferredError) { await finishWithoutSend(tx, job, "waiting", now, error.reason, error.nextAttemptAt); return "deferred"; }
      if (error instanceof SendUncertainError || error instanceof SendRejectedError) {
        const status = error instanceof SendUncertainError ? "unknown" : "failed";
        await finishWithoutSend(tx, job, status, now, error.code); return status;
      }
      throw error;
    }
  });
}

/** No database transaction or worker sleep spans the external call. */
export async function invokePreparedSend(prepared: Prepared, graph: GraphClient): Promise<SendResult> {
  return invokeBudgetedWrite({ startedAt: prepared.attempt.startedAt, monotonicStartedAt: prepared.permitClockStarted, validForMs: prepared.policy.send_permit_ms,
    deadlineAt: new Date(Math.min(prepared.job.hardExpiresAt.getTime(), prepared.job.kind === "expiry_fallback" ? Infinity : prepared.job.deadlineAt.getTime())),
  }, () => prepared.job.channel === "public_reply"
      ? graph.replyToComment(prepared.token, prepared.commentId!, prepared.payload.text)
      : prepared.job.channel === "private_reply"
        ? graph.sendPrivateReply(prepared.token, prepared.igUserId, prepared.commentId!, prepared.payload)
        : graph.sendMessage(prepared.token, prepared.igUserId, prepared.recipientId, prepared.payload));
}

export async function settleCampaignSend(deps: DispatchDeps, prepared: Prepared, result: SendResult): Promise<string> {
  return deps.db.transaction(async (tx) => {
    const [job] = await tx.select().from(dmJobs).where(eq(dmJobs.id, prepared.job.id)).for("update");
    const now = await (deps.clock ?? databaseNow)(tx);
    const [attempt] = await tx.select().from(sendAttempts).where(eq(sendAttempts.id, prepared.attempt.id));
    if (!attempt) return "deleted";
    if (!job || job.status !== "sending" || job.leaseOwner !== prepared.job.leaseOwner || job.leaseVersion !== prepared.job.leaseVersion || !job.leaseUntil || job.leaseUntil <= now || attempt.state !== "sending") {
      // Late responses cannot change the job outcome, but an explicit protection error still stops the account.
      if (!attempt.lateResult && result.state === "error" && result.failure.protection) await recordSendHealth(tx, attempt, result.failure, now, prepared.policy);
      await tx.update(sendAttempts).set({ lateResult: result.state === "accepted" ? { state: "accepted", providerMessageId: result.providerMessageId } : { state: result.state, errorCode: result.state === "error" ? result.failure.code : result.code } }).where(eq(sendAttempts.id, attempt.id));
      return "stale_lease";
    }
    let status: DmJob["status"];
    let errorCode: string | null = null;
    let nextAttemptAt = now;
    if (result.state === "not_invoked") {
      status = "waiting"; errorCode = result.code;
      await tx.update(sendAttempts).set({ state: "not_invoked", finishedAt: now, errorCode }).where(eq(sendAttempts.id, attempt.id));
    } else if (result.state === "accepted") {
      status = "sent";
      await tx.update(sendAttempts).set({ state: "accepted", invokedAt: result.invokedAt, finishedAt: now, providerMessageId: result.providerMessageId, payload: null }).where(eq(sendAttempts.id, attempt.id));
      await observeRateHint(tx, job.igAccountId, result.rateHint, now);
      await recordSendHealth(tx, attempt, null, now, prepared.policy);
    } else {
      status = result.failure.state; errorCode = result.failure.code;
      if (status === "retry") {
        if (job.attempts >= prepared.policy.max_attempts) status = "failed";
        else nextAttemptAt = new Date(now.getTime() + Math.max(result.failure.retryAfterMs ?? 0, backoffDelayMs(job.attempts, deps.random)));
      }
      // Only an explicit invalid-format rejection may switch format. Never a generic code 100.
      if (result.failure.state === "failed" && errorCode === "100/2534015" && prepared.payload.kind !== "text" && job.messageFormat !== "text" && job.attempts < prepared.policy.max_attempts) {
        status = "retry"; nextAttemptAt = new Date(now.getTime() + 1000);
        await tx.update(dmJobs).set({ messageFormat: "text" }).where(eq(dmJobs.id, job.id));
      }
      await tx.update(sendAttempts).set({ state: status === "unknown" ? "unknown" : "rejected", invokedAt: result.invokedAt, finishedAt: now, errorCode, payload: null }).where(eq(sendAttempts.id, attempt.id));
      await recordSendHealth(tx, attempt, result.failure, now, prepared.policy);
      if (result.failure.retryAfterMs) await observeRateHint(tx, job.igAccountId, { retryAfterMs: result.failure.retryAfterMs }, now);
    }
    const terminal = !["waiting", "retry"].includes(status);
    await tx.update(dmJobs).set({ status, lastErrorCode: errorCode, nextAttemptAt, completedAt: terminal ? now : null, leaseOwner: null, leaseUntil: null,
      ...(result.state === "not_invoked" ? { attempts: Math.max(0, job.attempts - 1) } : {}),
      ...(result.state === "accepted" ? { providerMessageId: result.providerMessageId } : {}),
    }).where(fence(job));
    if (status === "sent" || status === "unknown") {
      await tx.update(privateReplyClaims).set({ state: status }).where(eq(privateReplyClaims.jobId, job.id));
      await tx.update(campaignDeliveries).set({ state: status }).where(and(eq(campaignDeliveries.owningJobId, job.id),
        // A follow request/expiry notice does not deliver the shopping link.
        ["follow_request", "expiry_fallback"].includes(job.kind) ? inArray(campaignDeliveries.intent, ["initial_contact", "public_ack"]) : undefined));
    } else if (status === "failed") await tx.update(campaignDeliveries).set({ state: "failed" }).where(eq(campaignDeliveries.owningJobId, job.id));
    if (result.state !== "accepted") await releaseSendLease(tx, job.igAccountId, job.channel, job.leaseOwner!);
    return status;
  });
}

export async function dispatchCampaignJob(deps: DispatchDeps, job: DmJob): Promise<string> {
  let follow: { decision: FollowDecision; checkedAt: Date; version: number } | undefined;
  if (job.channel === "private_reply" && ["opening_link", "instant_link"].includes(job.kind) && job.jitterUntil) {
    const [context] = await deps.db.select({ campaign: campaigns, account: igAccounts, participant: campaignParticipants }).from(campaigns)
      .innerJoin(igAccounts, eq(igAccounts.id, campaigns.igAccountId)).innerJoin(campaignParticipants, eq(campaignParticipants.campaignId, campaigns.id))
      .where(and(eq(campaigns.id, job.campaignId), eq(campaigns.followOnly, true), eq(campaignParticipants.id, job.participantId)));
    if (context && !context.campaign.archivedAt) {
      const now = await (deps.clock ?? databaseNow)(deps.db);
      if (job.jitterUntil <= now && job.deadlineAt > now && job.leaseUntil && job.leaseUntil > now && effectiveCampaignState(context.campaign, now) === "open" && await campaignsEnabled(deps.db, job.igAccountId)) {
        const monotonic = performance.now();
        const decision = await checkCampaignFollower({ ...deps, now: () => new Date(now.getTime() + Math.ceil(performance.now() - monotonic)) }, context.account, context.participant.commenterIgId, context.campaign.followFailurePolicy);
        follow = { decision, checkedAt: now, version: context.campaign.version };
      }
    }
  }
  const prepared = await prepareCampaignSend(deps, job, follow);
  if (typeof prepared === "string") return prepared;
  return settleCampaignSend(deps, prepared, await invokePreparedSend(prepared, deps.graph));
}
