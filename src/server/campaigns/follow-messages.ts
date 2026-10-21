import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db, Executor } from "@/server/db/client";
import { campaigns, campaignDeliveries, campaignParticipants, commentEvents, conversationStates, dmJobs, followGates, igAccounts, messageEvents, sendAttempts, type MessageEvent } from "@/server/db/schema";
import { campaignGateId } from "@/server/instagram/campaign-messaging";
import type { GraphClient } from "@/server/instagram/graph";
import { CampaignError, campaignsEnabled, requireCampaignFeature } from "./access";
import { checkCampaignFollower } from "./follow-profile";
import { deferMessageEvent, finishMessageEvent, messageLeaseFence } from "./message-inbox";
import { CAMPAIGN_QUEUE_CHANNEL } from "./routing";
import { sendPolicy } from "./send-budget";
import { effectiveCampaignState } from "./state";

export interface MessageRouterDeps { db: Db; graph: GraphClient; now: () => Date; decryptToken: (value: string) => string }

export function isFollowConfirmation(text: string) {
  // Explicit confirmation only: an arbitrary DM (including "팔로우 안 했어요") is not a button tap.
  return /^(팔로우했어요|팔로우완료|팔로우했어|팔로우했습니다)$/u.test(text.normalize("NFC").replace(/[\s\p{P}\p{S}]/gu, ""));
}

async function replaceableUnsentJob(db: Executor, id: string) {
  const [job] = await db.select({ status: dmJobs.status, attempts: dmJobs.attempts }).from(dmJobs).where(eq(dmJobs.id, id));
  return job?.attempts === 0 && ["expired", "canceled"].includes(job.status);
}

/** Returns null for unrelated/legacy messages so the common inbox router can try another authorized handler. */
export async function routeCampaignFollowMessage(deps: MessageRouterDeps, message: MessageEvent): Promise<string | null> {
  const { db } = deps;
  if (!["message", "postback"].includes(message.kind)) return null;
  const gateId = campaignGateId(message.payload);
  if (!gateId && !isFollowConfirmation(message.text)) return null;
  if (message.payload && !gateId) return null; // Never reinterpret a legacy or unrelated action as a campaign gate.
  const candidates = await db.select({ job: dmJobs, campaign: campaigns, participant: campaignParticipants }).from(dmJobs)
    .innerJoin(campaigns, eq(campaigns.id, dmJobs.campaignId)).innerJoin(campaignParticipants, eq(campaignParticipants.id, dmJobs.participantId))
    .where(and(eq(dmJobs.igAccountId, message.igAccountId), eq(campaignParticipants.commenterIgId, message.peerId), eq(dmJobs.kind, "follow_request"),
      !gateId && !message.replyToMessageId ? sql`exists (select 1 from campaign_deliveries d where d.participant_id = ${dmJobs.participantId} and d.intent = 'link' and d.state in ('reserved','unknown') and (d.owning_job_id = ${dmJobs.id} or (d.state = 'reserved' and exists (select 1 from dm_jobs old where old.id = d.owning_job_id and old.attempts = 0 and old.status in ('expired','canceled')))))` : undefined,
      inArray(dmJobs.status, ["sent", "sending", "unknown"]), gateId ? eq(dmJobs.id, gateId) : message.replyToMessageId ? eq(dmJobs.providerMessageId, message.replyToMessageId) : undefined));
  if (!candidates.length) return null;
  // Direct text is ambiguous when another campaign or legacy gate is also awaiting this person.
  const legacy = !gateId && !message.replyToMessageId ? await db.select({ id: followGates.id }).from(followGates).innerJoin(commentEvents, eq(commentEvents.id, followGates.eventId))
    .where(and(eq(followGates.igAccountId, message.igAccountId), eq(commentEvents.commenterIgId, message.peerId), eq(followGates.status, "waiting"))).limit(1) : [];
  if (candidates.length !== 1 || legacy.length) {
    await finishMessageEvent(db, message, deps.now(), "ignored", "ambiguous_follow_context"); return "ambiguous";
  }
  const selected = candidates[0];
  const policy = await sendPolicy(db);
  const hardExpiresAt = message.occurredAt && new Date(message.occurredAt.getTime() + policy.message_window_seconds * 1000);
  const deadlineAt = hardExpiresAt && new Date(hardExpiresAt.getTime() - policy.message_safety_seconds * 1000);
  const finish = async (code: string) => { await finishMessageEvent(db, message, deps.now(), "ignored", code, selected.campaign.id); return code; };
  if (!deadlineAt || message.occurredAt! > deps.now() || deadlineAt <= deps.now() || message.deletedAt || (message.kind === "message" && !message.userMessageEvidence)) return finish("message_window_closed");
  if (!await campaignsEnabled(db, message.igAccountId)) {
    await deferMessageEvent(db, message, new Date(deps.now().getTime() + 60_000), "feature_disabled", true); return "held";
  }
  const [conversation] = await db.select().from(conversationStates).where(and(eq(conversationStates.igAccountId, message.igAccountId), eq(conversationStates.senderId, message.peerId)));
  // A postback can use an already verified open conversation, but does not create a new one.
  if (!conversation?.lastUserInteractionAt || conversation.lastUserInteractionAt > deps.now() || conversation.lastUserInteractionAt.getTime() + (policy.message_window_seconds - policy.message_safety_seconds) * 1000 <= deps.now().getTime()) return finish("message_window_closed");
  if (message.kind === "postback" && (!conversation.consentAt || conversation.consentAt > message.occurredAt! || conversation.lastUserInteractionAt > message.occurredAt!)) return finish("postback_without_prior_consent");
  if (selected.job.status === "unknown") return finish("initial_send_unknown");
  if (selected.job.status === "sending") {
    await deferMessageEvent(db, message, new Date(deps.now().getTime() + 5000), "initial_send_pending", true); return "waiting";
  }
  // The user response must follow this gate, not a historical message delivered late.
  const [acceptance] = await db.select({ at: sendAttempts.invokedAt }).from(sendAttempts).where(and(eq(sendAttempts.jobId, selected.job.id), eq(sendAttempts.state, "accepted"))).limit(1);
  if (!acceptance?.at || message.occurredAt! < acceptance.at) return finish("response_predates_gate");
  if (selected.campaign.archivedAt || effectiveCampaignState(selected.campaign, deps.now()) !== "open") return finish("campaign_closed");
  const [existingLink] = await db.select().from(campaignDeliveries).where(and(eq(campaignDeliveries.participantId, selected.participant.id), eq(campaignDeliveries.intent, "link")));
  if (existingLink && existingLink.owningJobId !== selected.job.id && !(existingLink.state === "reserved" && await replaceableUnsentJob(db, existingLink.owningJobId))) return finish("link_already_reserved");
  const [account] = await db.select().from(igAccounts).where(eq(igAccounts.id, message.igAccountId));
  if (!account) return finish("account_missing");
  const decision = await checkCampaignFollower(deps, account, message.peerId, selected.campaign.followFailurePolicy);
  if (decision.kind === "retry") {
    if (message.attempts >= policy.max_attempts) { await finishMessageEvent(db, message, deps.now(), "failed", decision.code); return "profile_failed"; }
    await deferMessageEvent(db, message, decision.nextAt, decision.code, decision.code === "api_cooldown"); return "profile_retry";
  }
  if (["blocked", "unknown", "no_consent"].includes(decision.kind)) { await finishMessageEvent(db, message, deps.now(), "failed", decision.code); return "profile_failed"; }
  const kind = decision.kind === "not_following" ? "follow_reminder" : "follow_link";
  return db.transaction(async (tx) => {
    // Match dispatch/routing lock order. Network reads above never hold a transaction open.
    const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, selected.campaign.id)).for("update");
    const [participant] = await tx.select().from(campaignParticipants).where(eq(campaignParticipants.id, selected.participant.id)).for("update");
    const [currentConversation] = await tx.select().from(conversationStates).where(and(eq(conversationStates.igAccountId, message.igAccountId), eq(conversationStates.senderId, message.peerId))).for("update");
    const [current] = await tx.select().from(messageEvents).where(messageLeaseFence(message)).for("update");
    const now = deps.now();
    if (!current || !current.leaseUntil || current.leaseUntil <= now) return "stale_lease";
    if (current.deletedAt || deadlineAt <= now || !campaign || !participant || campaign.archivedAt || effectiveCampaignState(campaign, now) !== "open") {
      await finishMessageEvent(tx, message, now, "ignored", "no_longer_eligible"); return "ignored";
    }
    if (!await campaignsEnabled(tx, message.igAccountId)) { await deferMessageEvent(tx, message, new Date(now.getTime() + 60_000), "feature_disabled", true); return "held"; }
    try { await requireCampaignFeature(tx, campaign.userId, "campaign.follow_gate"); }
    catch (error) { if (!(error instanceof CampaignError) || error.code !== "entitlement") throw error; await finishMessageEvent(tx, message, now, "ignored", "entitlement"); return "ignored"; }
    const intent = kind === "follow_link" ? "link" : "reminder";
    const [delivery] = await tx.select().from(campaignDeliveries).where(and(eq(campaignDeliveries.participantId, participant.id), eq(campaignDeliveries.intent, intent)));
    if (delivery && !(delivery.state === "reserved" && ((intent === "link" && delivery.owningJobId === selected.job.id) || await replaceableUnsentJob(tx, delivery.owningJobId)))) {
      await finishMessageEvent(tx, message, now, "ignored", "duplicate_follow_response"); return "duplicate";
    }
    const jobId = randomUUID();
    await tx.insert(dmJobs).values({ id: jobId, campaignId: campaign.id, igAccountId: account.id, participantId: participant.id,
      sourceEventId: selected.job.sourceEventId, sourceMessageEventId: current.id, channel: "message", kind,
      scheduledAt: now, nextAttemptAt: now, deadlineAt, hardExpiresAt: hardExpiresAt!, commentCreatedAt: message.occurredAt!,
      idempotencyKey: `campaign:${campaign.id}:person:${participant.id}:${intent}:response:${current.id}`,
    });
    await tx.insert(campaignDeliveries).values({ participantId: participant.id, intent, owningJobId: jobId })
      .onConflictDoUpdate({ target: [campaignDeliveries.participantId, campaignDeliveries.intent], set: { owningJobId: jobId, state: "reserved" } });
    if (currentConversation) await tx.update(conversationStates).set({ currentCampaignId: campaign.id }).where(and(eq(conversationStates.igAccountId, account.id), eq(conversationStates.senderId, message.peerId)));
    await finishMessageEvent(tx, message, now, "routed", decision.kind === "fail_open" ? `profile_fail_open:${decision.code}` : null, campaign.id);
    await tx.execute(sql`select pg_notify(${CAMPAIGN_QUEUE_CHANNEL}, '')`);
    return kind;
  });
}
