import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { sendJitter } from "@/lib/campaign-rate";
import type { Db, Executor } from "@/server/db/client";
import { automations, campaignParticipants, commentEvents, conversationStates, dmJobs, followGates, igAccounts, messageEvents, sendAttempts, type CommentEvent, type MessageEvent, type SendAttempt } from "@/server/db/schema";
import { getUserPlan } from "@/server/billing/plan-of";
import { isFollowConfirmation } from "@/server/campaigns/follow-messages";
import { checkCampaignFollower } from "@/server/campaigns/follow-profile";
import { legacySendGuard } from "@/server/campaigns/legacy-guard";
import { deferMessageEvent, finishMessageEvent, messageLeaseFence } from "@/server/campaigns/message-inbox";
import { acquireSendPermit, databaseNow, observeRateHint, recordSendHealth, releaseSendLease, sendPolicy, type SendPolicy } from "@/server/campaigns/send-budget";
import { invokeBudgetedWrite, type BudgetedWriteResult } from "@/server/campaigns/send-call";
import type { PrivateReplyMessage } from "@/server/instagram/graph";
import { backoffDelayMs } from "@/server/queue/backoff";
import { SendDeferredError, SendRejectedError, SendUncertainError } from "@/server/queue/send-errors";
import { buildLinkDm } from "./dm-content";
import type { PipelineDeps } from "./process-comment";

export type FollowInboxDeps = Pick<PipelineDeps, "db" | "graph" | "now" | "random" | "decryptToken" | "appUrl"> & { clock?: (db: Executor) => Promise<Date> };
type Gate = typeof followGates.$inferSelect;
type Conversation = typeof conversationStates.$inferSelect;
type Intent = "link" | "reminder";
type Locked = { event: CommentEvent; gate: Gate; message: MessageEvent; conversation: Conversation | undefined; history: SendAttempt[] };
type Prepared = { locked: Locked; attempt: SendAttempt; policy: SendPolicy; token: string; igUserId: string; payload: PrivateReplyMessage; deadlineAt: Date; monotonicStartedAt: number };
const intentKey = (gate: Gate, intent: Intent) => `legacy-follow:${gate.id}:${intent}`;

/** This order also fences the legacy comment worker while an ordinary DM is in flight. */
async function lockContext(tx: Executor, source: MessageEvent, eventId: string): Promise<Locked | null> {
  const [event] = await tx.select().from(commentEvents).where(eq(commentEvents.id, eventId)).for("update");
  const [gate] = await tx.select().from(followGates).where(eq(followGates.eventId, eventId)).for("update");
  const [conversation] = await tx.select().from(conversationStates).where(and(eq(conversationStates.igAccountId, source.igAccountId), eq(conversationStates.senderId, source.peerId))).for("update");
  const [message] = await tx.select().from(messageEvents).where(messageLeaseFence(source)).for("update");
  if (!event || !gate || !message || message.campaignId || (message.legacyEventId && message.legacyEventId !== eventId) || event.igAccountId !== source.igAccountId || event.commenterIgId !== source.peerId) return null;
  const history = await tx.select().from(sendAttempts).where(eq(sendAttempts.legacyEventId, eventId)).orderBy(desc(sendAttempts.startedAt), desc(sendAttempts.attempt));
  return { event, gate, conversation, message, history };
}

export async function markLegacyFollowUnknown(tx: Executor, source: MessageEvent, eventId: string, now: Date, code: string) {
  await tx.update(messageEvents).set({ status: "send_unknown", lastErrorCode: code, leaseUntil: null, completedAt: now }).where(messageLeaseFence(source));
  await tx.update(commentEvents).set({ status: "send_unknown", errorCode: code, errorMessage: "발송 결과 확인이 필요해요. 자동 재발송하지 않아요.", lockedAt: null, completedAt: now }).where(eq(commentEvents.id, eventId));
}

async function acceptLink(tx: Executor, context: Locked, id: string, now: Date) {
  const unresolved = context.history.some((a) => a.state === "unknown");
  await tx.update(followGates).set({ status: "sent", senderId: context.message.peerId, completedAt: now }).where(eq(followGates.id, context.gate.id));
  await tx.update(commentEvents).set({ dmStatus: "sent", dmMessageId: id,
    // A deferred public reply still needs its original queue entry. Do not lose it when the link wins the race.
    status: unresolved ? "send_unknown" : context.event.status === "pending" ? "pending" : context.event.replyStatus === "failed" ? "partial" : "succeeded",
    completedAt: context.event.status === "pending" && !unresolved ? null : now,
    ...(!unresolved ? { errorCode: null, errorMessage: null } : {}),
  }).where(eq(commentEvents.id, context.event.id));
}

/** Check durable outcomes before profile reads or rendering; never turn an unknown write into a retry. */
async function reconcile(tx: Executor, context: Locked, now: Date, intent?: Intent): Promise<string | null> {
  const { event, gate, message, history } = context;
  if (!message.leaseUntil || message.leaseUntil <= now) return "stale_lease";
  if (event.status === "processing") { await deferMessageEvent(tx, message, new Date(now.getTime() + 1000), "comment_in_flight", true); return "waiting"; }
  const link = history.find((a) => a.logicalKey === intentKey(gate, "link") && a.state === "accepted" && a.providerMessageId);
  if (link || (event.dmStatus === "sent" && event.dmMessageId)) {
    await acceptLink(tx, context, link?.providerMessageId ?? event.dmMessageId!, now);
    await finishMessageEvent(tx, message, now, "routed", "link_already_sent"); return "duplicate";
  }
  const inFlight = history.find((a) => a.state === "sending");
  if (inFlight) {
    // The recovery pass owns expired writes. A duplicate invocation must not revoke a live lease.
    if (inFlight.sourceMessageEventId !== message.id) await deferMessageEvent(tx, message, new Date(now.getTime() + 5000), "send_in_flight", true);
    return "in_flight";
  }
  if (history.some((a) => a.state === "unknown" && (a.channel === "private_reply" || a.logicalKey === intentKey(gate, "link") || (intent && a.logicalKey === intentKey(gate, intent))))) {
    await markLegacyFollowUnknown(tx, message, event.id, now, "previous_attempt_unresolved"); return "send_unknown";
  }
  // Pre-ledger failures could have been accepted externally. A waiting/sent gate alone proves nothing.
  if ((gate.checks > 0 || gate.status === "sent") && !history.some((a) => a.channel === "message")) {
    await markLegacyFollowUnknown(tx, message, event.id, now, "legacy_follow_history_unverified"); return "send_unknown";
  }
  if (intent) {
    const previous = history.find((a) => a.logicalKey === intentKey(gate, intent));
    if (previous?.state === "accepted") { await finishMessageEvent(tx, message, now, "routed", "reminder_already_sent"); return "duplicate"; }
    if (previous?.state === "rejected" && previous.sourceMessageEventId) {
      const [owner] = await tx.select({ status: messageEvents.status, code: messageEvents.lastErrorCode }).from(messageEvents).where(eq(messageEvents.id, previous.sourceMessageEventId));
      if (owner && ["failed", "ignored"].includes(owner.status)) { await finishMessageEvent(tx, message, now, "failed", owner.code); return "failed"; }
    }
  }
  return null;
}

async function eligible(tx: Executor, context: Locked, now: Date, policy: SendPolicy): Promise<Date | string> {
  const { message, conversation, event, history } = context;
  const fail = async (code: string) => { await finishMessageEvent(tx, message, now, "ignored", code); return code; };
  const anchor = message.occurredAt;
  if (!anchor || anchor > now || message.deletedAt || !["message", "postback"].includes(message.kind) || (message.kind === "message" && !message.userMessageEvidence)) return fail("source_message_unavailable");
  if (!conversation?.consentAt || !conversation.lastUserInteractionAt || conversation.lastUserInteractionAt > now) return fail("message_window_closed");
  if (message.kind === "postback" && (conversation.consentAt > anchor || conversation.lastUserInteractionAt > anchor)) return fail("postback_without_prior_consent");
  const deadline = new Date(Math.min(anchor.getTime(), conversation.lastUserInteractionAt.getTime()) + (policy.message_window_seconds - policy.message_safety_seconds) * 1000);
  if (deadline <= now) return fail("message_window_closed");
  const privateAccepted = history.find((a) => a.channel === "private_reply" && a.state === "accepted");
  if (!event.dmMessageId && !privateAccepted) return fail("initial_send_unconfirmed");
  const sentAt = privateAccepted?.invokedAt ?? event.completedAt;
  if (!sentAt || anchor < sentAt) return fail("response_predates_gate");
  if (conversation.pendingEchoEventId) {
    await deferMessageEvent(tx, message, new Date(now.getTime() + 5000), "echo_pending", true); return "held";
  }
  if (conversation.automationPausedUntil && conversation.automationPausedUntil > now) {
    await deferMessageEvent(tx, message, conversation.automationPausedUntil, "human_handoff", true); return "held";
  }
  return deadline;
}

async function selectGate(db: Db, message: MessageEvent): Promise<Gate[] | null> {
  if (!["message", "postback"].includes(message.kind)) return null;
  const gateId = /^fg:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(message.payload ?? "")?.[1];
  if (message.payload && !gateId) return null;
  if (!gateId && !isFollowConfirmation(message.text)) return null;
  const rows = await db.select({ gate: followGates }).from(followGates).innerJoin(commentEvents, eq(commentEvents.id, followGates.eventId)).where(and(
    eq(followGates.igAccountId, message.igAccountId), eq(commentEvents.commenterIgId, message.peerId),
    message.legacyEventId ? eq(commentEvents.id, message.legacyEventId) : gateId ? eq(followGates.id, gateId) : message.replyToMessageId ? eq(commentEvents.dmMessageId, message.replyToMessageId) : eq(followGates.status, "waiting"),
  ));
  if (!gateId && !message.replyToMessageId && !message.legacyEventId && rows.length) {
    const [campaign] = await db.select({ id: dmJobs.id }).from(dmJobs).innerJoin(campaignParticipants, eq(campaignParticipants.id, dmJobs.participantId)).where(and(eq(dmJobs.igAccountId, message.igAccountId), eq(campaignParticipants.commenterIgId, message.peerId), eq(dmJobs.kind, "follow_request"), inArray(dmJobs.status, ["sent", "sending", "unknown"]), sql`exists (select 1 from campaign_deliveries d where d.participant_id = ${dmJobs.participantId} and d.intent = 'link' and d.state in ('reserved','unknown'))`)).limit(1);
    if (campaign) return []; // Ambiguous explicit text must not pick whichever router ran first.
  }
  return rows.map((r) => r.gate);
}

export async function routeLegacyFollowMessage(deps: FollowInboxDeps, source: MessageEvent): Promise<string | null> {
  const gates = await selectGate(deps.db, source);
  if (!gates) return null;
  if (gates.length !== 1) { await finishMessageEvent(deps.db, source, deps.now(), "ignored", gates.length ? "ambiguous_follow_context" : "follow_context_unavailable"); return "ignored"; }
  const gate = gates[0]; const policy = await sendPolicy(deps.db);
  // Guard remains in force for a reply to an earlier guarded gate, including after flag OFF.
  await legacySendGuard(deps.db, source.igAccountId, deps.now(), { force: true });
  const initial = await deps.db.transaction(async (tx) => {
    const context = await lockContext(tx, source, gate.eventId);
    if (!context) return "stale_lease";
    const now = await (deps.clock ?? databaseNow)(tx);
    await tx.update(messageEvents).set({ legacyEventId: gate.eventId }).where(messageLeaseFence(source));
    const done = await reconcile(tx, context, now); if (done) return done;
    const deadline = await eligible(tx, context, now, policy);
    return typeof deadline === "string" ? deadline : null;
  });
  if (initial) return initial;
  const [account] = await deps.db.select().from(igAccounts).where(eq(igAccounts.id, source.igAccountId));
  if (!account) return "deleted";
  const decision = await checkCampaignFollower(deps, account, source.peerId, "hold");
  if (decision.kind === "retry") {
    if (source.attempts >= policy.max_attempts && decision.code !== "api_cooldown") await finishMessageEvent(deps.db, source, deps.now(), "failed", decision.code);
    else await deferMessageEvent(deps.db, source, decision.nextAt, decision.code, decision.code === "api_cooldown");
    return "profile_retry";
  }
  if (!["following", "not_following"].includes(decision.kind)) { await finishMessageEvent(deps.db, source, deps.now(), "failed", decision.code); return "profile_failed"; }
  const intent: Intent = decision.kind === "following" ? "link" : "reminder";
  const prepared = await deps.db.transaction(async (tx): Promise<Prepared | string> => {
    const context = await lockContext(tx, source, gate.eventId);
    if (!context) return "stale_lease";
    const now = await (deps.clock ?? databaseNow)(tx);
    const done = await reconcile(tx, context, now, intent); if (done) return done;
    const deadline = await eligible(tx, context, now, policy); if (typeof deadline === "string") return deadline;
    const { event, message } = context;
    const [automation] = event.automationId ? await tx.select().from(automations).where(eq(automations.id, event.automationId)) : [];
    if (!automation || !automation.isActive || !automation.followGate) { await finishMessageEvent(tx, message, now, "ignored", "automation_inactive"); return "ignored"; }
    const jitterUntil = message.jitterUntil ?? new Date(now.getTime() + sendJitter(policy.jitter_min_ms, policy.jitter_max_ms, deps.random));
    await tx.update(messageEvents).set({ legacyIntent: intent, jitterUntil }).where(messageLeaseFence(message));
    if (jitterUntil > now) { await deferMessageEvent(tx, message, jitterUntil, "jitter", true); return "waiting"; }
    let payload: PrivateReplyMessage = { kind: "text", text: "아직 팔로우가 확인되지 않았어요 🙏\n팔로우한 뒤 ‘팔로우했어요’라고 답장해 주세요." };
    if (intent === "link") {
      const dm = await buildLinkDm({ db: tx, appUrl: deps.appUrl }, { event, automation, plan: await getUserPlan(tx, account.userId) });
      // Persisted format belongs to the logical intent, even if another user response claims its retry.
      const previousFormatFailure = context.history.some((a) => a.logicalKey === intentKey(gate, intent) && a.state === "rejected" && a.errorCode === "100/2534015");
      payload = message.messageFormat === "text" || account.dmFormat === "text" || previousFormatFailure ? dm.text : dm.button;
    }
    const token = deps.decryptToken(account.accessTokenEnc!);
    const monotonicStartedAt = performance.now(); const permitAt = await (deps.clock ?? databaseNow)(tx);
    try {
      const permit = await acquireSendPermit(tx, { igAccountId: account.id, legacyEventId: event.id, sourceMessageEventId: message.id, channel: "message", logicalKey: intentKey(gate, intent), leaseOwner: randomUUID(), leaseVersion: message.leaseVersion, payload, now: permitAt, extendSafety: true }, policy, deps.random);
      if (permit.cached) {
        if (intent === "link") await acceptLink(tx, context, permit.providerMessageId, now);
        await finishMessageEvent(tx, message, now, "routed", "already_sent"); return "duplicate";
      }
      const [leased] = await tx.update(messageEvents).set({ leaseUntil: new Date(permitAt.getTime() + policy.dispatch_lease_seconds * 1000) }).where(messageLeaseFence(message)).returning();
      return { locked: { ...context, message: leased }, attempt: permit.attempt, policy, token, igUserId: account.igUserId, payload, deadlineAt: deadline, monotonicStartedAt };
    } catch (error) {
      if (error instanceof SendDeferredError) { await deferMessageEvent(tx, message, error.nextAttemptAt, error.reason, true); return "deferred"; }
      if (error instanceof SendUncertainError) { await markLegacyFollowUnknown(tx, message, event.id, now, error.code); return "send_unknown"; }
      if (error instanceof SendRejectedError) { await finishMessageEvent(tx, message, now, "failed", error.code); return "failed"; }
      throw error;
    }
  });
  if (typeof prepared === "string") return prepared;
  const result = await invokeBudgetedWrite({ startedAt: prepared.attempt.startedAt, monotonicStartedAt: prepared.monotonicStartedAt, validForMs: policy.send_permit_ms, deadlineAt: prepared.deadlineAt }, () => deps.graph.sendMessage(prepared.token, prepared.igUserId, source.peerId, prepared.payload));
  return settleLegacyFollow(deps, prepared, result);
}

async function settleLegacyFollow(deps: FollowInboxDeps, prepared: Prepared, result: BudgetedWriteResult) {
  return deps.db.transaction(async (tx) => {
    const context = await lockContext(tx, prepared.locked.message, prepared.locked.event.id);
    const now = await (deps.clock ?? databaseNow)(tx);
    const [attempt] = await tx.select().from(sendAttempts).where(eq(sendAttempts.id, prepared.attempt.id));
    if (!attempt) return "deleted";
    if (!context || !context.message.leaseUntil || context.message.leaseUntil <= now || attempt.state !== "sending") {
      if (!attempt.lateResult && result.state === "error" && result.failure.protection) await recordSendHealth(tx, attempt, result.failure, now, prepared.policy);
      await tx.update(sendAttempts).set({ lateResult: result.state === "accepted" ? { state: "accepted", providerMessageId: result.providerMessageId } : { state: result.state, errorCode: result.state === "error" ? result.failure.code : result.code } }).where(eq(sendAttempts.id, attempt.id));
      return "stale_lease";
    }
    const message = context.message;
    if (result.state === "accepted") {
      await tx.update(sendAttempts).set({ state: "accepted", invokedAt: result.invokedAt, finishedAt: now, providerMessageId: result.providerMessageId, payload: null }).where(eq(sendAttempts.id, attempt.id));
      if (message.legacyIntent === "link") await acceptLink(tx, context, result.providerMessageId, now);
      await finishMessageEvent(tx, message, now, "routed", null);
      await observeRateHint(tx, attempt.igAccountId, result.rateHint, now);
      await recordSendHealth(tx, attempt, null, now, prepared.policy);
      return "sent";
    }
    if (result.state === "not_invoked") {
      await tx.update(sendAttempts).set({ state: "not_invoked", finishedAt: now, errorCode: result.code, payload: null }).where(eq(sendAttempts.id, attempt.id));
      await releaseSendLease(tx, attempt.igAccountId, "message", attempt.leaseOwner);
      await deferMessageEvent(tx, message, now, result.code, true); return "waiting";
    }
    const failure = result.failure;
    await tx.update(sendAttempts).set({ state: failure.state === "unknown" ? "unknown" : "rejected", invokedAt: result.invokedAt, finishedAt: now, errorCode: failure.code, payload: null }).where(eq(sendAttempts.id, attempt.id));
    await recordSendHealth(tx, attempt, failure, now, prepared.policy);
    if (failure.retryAfterMs) await observeRateHint(tx, attempt.igAccountId, { retryAfterMs: failure.retryAfterMs }, now);
    await releaseSendLease(tx, attempt.igAccountId, "message", attempt.leaseOwner);
    if (failure.state === "unknown") { await markLegacyFollowUnknown(tx, message, context.event.id, now, failure.code); return "send_unknown"; }
    const called = context.history.filter((a) => a.logicalKey === attempt.logicalKey && a.state !== "not_invoked").length;
    const formatFallback = failure.state === "failed" && failure.code === "100/2534015" && prepared.payload.kind !== "text";
    if ((failure.state === "retry" || formatFallback) && called < prepared.policy.max_attempts) {
      if (formatFallback) await tx.update(messageEvents).set({ messageFormat: "text" }).where(messageLeaseFence(message));
      await deferMessageEvent(tx, message, new Date(now.getTime() + Math.max(failure.retryAfterMs ?? 0, backoffDelayMs(called, deps.random))), failure.code);
      return "retry";
    }
    await finishMessageEvent(tx, message, now, failure.state === "expired" ? "ignored" : "failed", failure.code);
    return "failed";
  });
}
