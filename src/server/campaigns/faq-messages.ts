import { createHmac, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { matchCampaignFaq } from "@/lib/campaign-faq";
import { campaignFaqs, campaignParticipants, campaigns, conversationStates, dmJobs, messageEvents, type MessageEvent } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import type { MessageRouterDeps } from "./follow-messages";
import { CampaignError, campaignPolicy, campaignsEnabled, requireCampaignFeature } from "./access";
import { faqHandoffReady } from "./faq-access";
import { deferMessageEvent, finishMessageEvent, messageLeaseFence } from "./message-inbox";
import { sendPolicy } from "./send-budget";
import { effectiveCampaignState } from "./state";
import { CAMPAIGN_QUEUE_CHANNEL } from "./routing";

export async function routeCampaignFaq(deps: MessageRouterDeps, message: MessageEvent): Promise<string | null> {
  if (message.kind !== "message" || !message.userMessageEvidence || message.payload || !message.text.trim() || message.legacyEventId) return null;
  const { db } = deps; const now = deps.now();
  if (!await campaignsEnabled(db, message.igAccountId) || !await faqHandoffReady(db, message.igAccountId)) return null;
  const policy = await sendPolicy(db);
  const hardExpiresAt = message.occurredAt && new Date(message.occurredAt.getTime() + policy.message_window_seconds * 1000);
  const deadlineAt = hardExpiresAt && new Date(hardExpiresAt.getTime() - policy.message_safety_seconds * 1000);
  const finish = async (code: string) => { await finishMessageEvent(db, message, deps.now(), "ignored", code); return code; };
  if (!deadlineAt || !message.occurredAt || message.occurredAt > now || deadlineAt <= now || message.deletedAt) return finish("message_window_closed");
  // An explicit reply must resolve to this sender's known Ringpo delivery. Never guess another campaign.
  let selectedId = message.campaignId;
  if (message.replyToMessageId) {
    const replies = await db.select({ campaignId: dmJobs.campaignId }).from(dmJobs).innerJoin(campaignParticipants, eq(campaignParticipants.id, dmJobs.participantId))
      .where(and(eq(dmJobs.igAccountId, message.igAccountId), eq(dmJobs.providerMessageId, message.replyToMessageId), eq(dmJobs.status, "sent"), eq(campaignParticipants.commenterIgId, message.peerId))).limit(2);
    if (replies.length !== 1 || (selectedId && selectedId !== replies[0].campaignId)) return finish("ambiguous_faq_context");
    selectedId = replies[0].campaignId;
  }
  if (!selectedId) {
    const contexts = await db.select({ id: campaigns.id }).from(campaigns).innerJoin(campaignParticipants, eq(campaignParticipants.campaignId, campaigns.id))
      .where(and(eq(campaigns.igAccountId, message.igAccountId), eq(campaignParticipants.commenterIgId, message.peerId), isNull(campaigns.archivedAt), eq(campaigns.status, "open"), sql`${campaigns.closeAt} > ${now.toISOString()}::timestamptz`)).limit(2);
    if (contexts.length > 1) return finish("ambiguous_faq_context");
    selectedId = contexts[0]?.id ?? null;
  }
  if (!selectedId) {
    // A person who starts a DM without a comment is eligible only when there is one unambiguous open campaign.
    const open = await db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.igAccountId, message.igAccountId), eq(campaigns.status, "open"), isNull(campaigns.archivedAt), sql`${campaigns.closeAt} > ${now.toISOString()}::timestamptz`)).limit(2);
    if (open.length !== 1) return open.length ? finish("ambiguous_faq_context") : null;
    selectedId = open[0].id;
  }
  return db.transaction(async (tx) => {
    const [campaign] = await tx.select().from(campaigns).where(and(eq(campaigns.id, selectedId!), eq(campaigns.igAccountId, message.igAccountId))).for("update");
    const where = and(eq(conversationStates.igAccountId, message.igAccountId), eq(conversationStates.senderId, message.peerId));
    const [conversation] = await tx.select().from(conversationStates).where(where).for("update");
    const [current] = await tx.select().from(messageEvents).where(messageLeaseFence(message)).for("update");
    const at = deps.now();
    if (!current || !current.leaseUntil || current.leaseUntil <= at) return "stale_lease";
    const ignored = async (code: string) => { await finishMessageEvent(tx, current, at, "ignored", code, campaign?.id); return code; };
    if (!campaign || campaign.archivedAt || effectiveCampaignState(campaign, at) !== "open") return ignored("campaign_closed");
    if (!await campaignsEnabled(tx, message.igAccountId) || !await faqHandoffReady(tx, message.igAccountId)) return ignored("faq_not_ready");
    try { await requireCampaignFeature(tx, campaign.userId, "campaign.faq"); }
    catch (error) { if (!(error instanceof CampaignError) || error.code !== "entitlement") throw error; return ignored("entitlement"); }
    if (current.deletedAt || deadlineAt <= at || !conversation?.lastUserInteractionAt || conversation.lastUserInteractionAt > at || conversation.lastUserInteractionAt.getTime() + (policy.message_window_seconds - policy.message_safety_seconds) * 1000 <= at.getTime()) return ignored("message_window_closed");
    if (conversation.pendingEchoEventId) { await deferMessageEvent(tx, current, new Date(at.getTime() + 5000), "echo_pending", true); return "echo_pending"; }
    if ((conversation.automationPausedUntil && conversation.automationPausedUntil > at) || (conversation.lastHumanAt && current.occurredAt! <= conversation.lastHumanAt)) return ignored("human_handoff");
    const rules = await tx.select().from(campaignFaqs).where(eq(campaignFaqs.campaignId, campaign.id));
    const rule = matchCampaignFaq(current.text, rules);
    if (!rule) return ignored("no_matching_faq");
    const cooldown = await campaignPolicy(tx, "faq_cooldown_seconds") * 1000;
    if (conversation.lastFaqAt && at.getTime() < conversation.lastFaqAt.getTime() + cooldown) return ignored("faq_cooldown");
    const [pending] = await tx.select({ id: dmJobs.id }).from(dmJobs).innerJoin(campaignParticipants, eq(campaignParticipants.id, dmJobs.participantId))
      .where(and(eq(dmJobs.igAccountId, message.igAccountId), eq(campaignParticipants.commenterIgId, message.peerId), eq(dmJobs.kind, "faq"), inArray(dmJobs.status, ["waiting", "retry", "leased", "sending", "held", "unknown"]))).limit(1);
    if (pending) return ignored("faq_response_pending");
    const [participant] = await tx.insert(campaignParticipants).values({ campaignId: campaign.id, igAccountId: campaign.igAccountId, commenterIgId: current.peerId,
      recipientHash: createHmac("sha256", getEnv().ENCRYPTION_KEY).update(`gonggu:${campaign.id}:${current.peerId}`).digest("hex"),
      // Legacy column name: for DM-only entrants this is the first verified inbound interaction.
      firstCommentCreatedAt: current.occurredAt!,
    }).onConflictDoUpdate({ target: [campaignParticipants.campaignId, campaignParticipants.commenterIgId], set: { commenterIgId: current.peerId } }).returning();
    const jobId = randomUUID();
    const [job] = await tx.insert(dmJobs).values({ id: jobId, campaignId: campaign.id, igAccountId: campaign.igAccountId, participantId: participant.id,
      sourceMessageEventId: current.id, faqId: rule.id, channel: "message", kind: "faq", scheduledAt: at, nextAttemptAt: at,
      deadlineAt, hardExpiresAt: hardExpiresAt!, commentCreatedAt: current.occurredAt!, idempotencyKey: `faq:message:${current.id}`,
    }).onConflictDoNothing().returning({ id: dmJobs.id });
    if (!job) return ignored("duplicate_faq_response");
    await tx.update(conversationStates).set({ currentCampaignId: campaign.id, lastFaqAt: at, updatedAt: at }).where(where);
    await finishMessageEvent(tx, current, at, "routed", "faq", campaign.id);
    await tx.execute(sql`select pg_notify(${CAMPAIGN_QUEUE_CHANNEL}, '')`);
    return "faq";
  });
}
