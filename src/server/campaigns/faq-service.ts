import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { faqInputSchema } from "@/lib/campaign-faq";
import type { Db, Executor } from "@/server/db/client";
import { campaignAuditEvents, campaignFaqs, campaignParticipants, campaigns, commentEvents, conversationStates, messageEvents } from "@/server/db/schema";
import { CampaignError, campaignPolicy, campaignsEnabled, requireCampaignFeature } from "./access";
import { faqHandoffReady } from "./faq-access";
import { databaseNow } from "./send-budget";

async function ownedCampaign(db: Executor, userId: string, id: string, lock = false) {
  const query = db.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)));
  const [campaign] = await (lock ? query.for("update") : query);
  if (!campaign) throw new CampaignError("not_found", "공구를 찾을 수 없어요");
  return campaign;
}
export async function campaignFaqOverview(db: Executor, userId: string, id: string, before?: string) {
  const campaign = await ownedCampaign(db, userId, id);
  if (!await campaignsEnabled(db, campaign.igAccountId)) throw new CampaignError("disabled", "공구 기능이 꺼져 있어요");
  let cursor: { at: string; id: string } | undefined;
  if (before) {
    try { if (before.length > 200) throw new Error(); cursor = z.object({ at: z.iso.datetime(), id: z.uuid() }).parse(JSON.parse(Buffer.from(before, "base64url").toString())); }
    catch { throw new CampaignError("validation", "대화 목록의 페이지를 확인해주세요"); }
  }
  const [rules, ready, conversations] = await Promise.all([
    db.select().from(campaignFaqs).where(eq(campaignFaqs.campaignId, id)).orderBy(asc(campaignFaqs.priority), asc(campaignFaqs.id)),
    faqHandoffReady(db, campaign.igAccountId),
    db.select({ participantId: campaignParticipants.id, username: commentEvents.commenterUsername, preview: sql<string>`left(${messageEvents.text}, 80)`, pausedUntil: conversationStates.automationPausedUntil, pendingEcho: conversationStates.pendingEchoEventId, lastInteraction: conversationStates.lastUserInteractionAt })
      .from(campaignParticipants).innerJoin(conversationStates, and(eq(conversationStates.igAccountId, campaignParticipants.igAccountId), eq(conversationStates.senderId, campaignParticipants.commenterIgId)))
      .leftJoin(commentEvents, eq(commentEvents.id, campaignParticipants.firstEventId))
      .leftJoin(messageEvents, sql`${messageEvents.id} = case when ${conversationStates.lastUserEventId} ~ '^[0-9a-f-]{36}$' then ${conversationStates.lastUserEventId}::uuid else null end`)
      .where(and(eq(campaignParticipants.campaignId, id), cursor ? sql`(coalesce(${conversationStates.lastUserInteractionAt}, 'epoch'::timestamptz), ${campaignParticipants.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : undefined))
      .orderBy(sql`coalesce(${conversationStates.lastUserInteractionAt}, 'epoch'::timestamptz) desc`, desc(campaignParticipants.id)).limit(51),
  ]);
  const items = conversations.slice(0, 50); const last = items.at(-1);
  return { rules, ready, conversations: items.map((c) => ({ ...c, pendingEcho: Boolean(c.pendingEcho), pausedUntil: c.pausedUntil?.toISOString() ?? null, lastInteraction: c.lastInteraction?.toISOString() ?? null })),
    nextCursor: conversations.length > 50 && last ? Buffer.from(JSON.stringify({ at: (last.lastInteraction ?? new Date(0)).toISOString(), id: last.participantId })).toString("base64url") : null };
}
export async function saveCampaignFaq(db: Db, userId: string, raw: unknown, at?: Date) {
  const parsed = faqInputSchema.safeParse(raw); if (!parsed.success) throw new CampaignError("validation", parsed.error.issues[0]?.message ?? "FAQ를 확인해주세요");
  const input = parsed.data;
  return db.transaction(async (tx) => {
    const campaign = await ownedCampaign(tx, userId, input.campaignId, true);
    if (!await campaignsEnabled(tx, campaign.igAccountId) || campaign.archivedAt) throw new CampaignError("disabled", "공구 설정을 변경할 수 없어요");
    await requireCampaignFeature(tx, userId, "campaign.faq");
    const [prior] = await tx.select().from(campaignAuditEvents).where(and(eq(campaignAuditEvents.campaignId, campaign.id), eq(campaignAuditEvents.requestId, input.requestId)));
    if (prior) return;
    const now = at ?? await databaseNow(tx);
    const values = { keywords: [...new Set(input.keywords.map((k) => k.normalize("NFC")))], excludedKeywords: [...new Set(input.excludedKeywords.map((k) => k.normalize("NFC")))], matchType: input.matchType, answer: input.answer, enabled: input.enabled, priority: input.priority, updatedAt: now };
    if (input.id) {
      const [rule] = await tx.select().from(campaignFaqs).where(and(eq(campaignFaqs.id, input.id), eq(campaignFaqs.campaignId, campaign.id)));
      if (!rule) throw new CampaignError("not_found", "FAQ를 찾을 수 없어요");
      if (rule.version !== input.expectedVersion) throw new CampaignError("conflict", "FAQ가 변경됐어요. 새로고침해주세요");
      await tx.update(campaignFaqs).set({ ...values, version: rule.version + 1 }).where(eq(campaignFaqs.id, rule.id));
    } else {
      const [count] = await tx.select({ value: sql<number>`count(*)::int` }).from(campaignFaqs).where(eq(campaignFaqs.campaignId, campaign.id));
      if (count.value >= await campaignPolicy(tx, "faq_max_rules")) throw new CampaignError("limit", "공구의 FAQ 설정 한도에 도달했어요");
      await tx.insert(campaignFaqs).values({ campaignId: campaign.id, ...values });
    }
    await tx.insert(campaignAuditEvents).values({ campaignId: campaign.id, actorId: userId, action: "faq_changed", version: campaign.version, requestId: input.requestId, reason: "FAQ 응답 설정 변경", effectiveAt: now, createdAt: now });
  });
}

export async function setConversationPause(db: Db, userId: string, raw: unknown, at?: Date) {
  const parsed = z.object({ campaignId: z.uuid(), participantId: z.uuid(), paused: z.boolean(), requestId: z.uuid() }).safeParse(raw);
  if (!parsed.success) throw new CampaignError("validation", "대화 설정을 확인해주세요");
  const input = parsed.data;
  return db.transaction(async (tx) => {
    const campaign = await ownedCampaign(tx, userId, input.campaignId, true);
    const [participant] = await tx.select().from(campaignParticipants).where(and(eq(campaignParticipants.id, input.participantId), eq(campaignParticipants.campaignId, campaign.id)));
    if (!participant) throw new CampaignError("not_found", "대화를 찾을 수 없어요");
    const [prior] = await tx.select().from(campaignAuditEvents).where(and(eq(campaignAuditEvents.campaignId, campaign.id), eq(campaignAuditEvents.requestId, input.requestId)));
    if (prior) return;
    const where = and(eq(conversationStates.igAccountId, campaign.igAccountId), eq(conversationStates.senderId, participant.commenterIgId));
    const [conversation] = await tx.select().from(conversationStates).where(where).for("update");
    if (!conversation) throw new CampaignError("not_found", "받은 메시지가 없는 대화예요");
    const now = at ?? await databaseNow(tx);
    await tx.update(conversationStates).set({ automationPausedUntil: input.paused ? new Date(now.getTime() + await campaignPolicy(tx, "faq_handoff_seconds") * 1000) : null,
      // Resume does not replay questions that the seller already took over or bypass pending echo review.
      ...(input.paused ? { lastHumanAt: now } : {}), updatedAt: now }).where(where);
    await tx.insert(campaignAuditEvents).values({ campaignId: campaign.id, actorId: userId, action: "conversation_pause", version: campaign.version, requestId: input.requestId, reason: input.paused ? "대화 자동 응답 일시정지" : "대화 자동 응답 재개", effectiveAt: now, createdAt: now });
  });
}
