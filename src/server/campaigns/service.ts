import { queueCampaignReport } from "./report-operations";
import { campaignReportMetrics } from "./report";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { campaignInputSchema, type CampaignInput, type CampaignState } from "@/lib/campaign-schema";
import type { Db, Executor } from "@/server/db/client";
import { campaigns, campaignProducts, campaignMedia, campaignAuditEvents, featureFlags, featureFlagOverrides, type Campaign } from "@/server/db/schema";
import type { GraphClient, MediaInfo } from "@/server/instagram/graph";
import { CAMPAIGN_FLAG, CampaignError, campaignEntitlements, campaignPolicy, campaignsEnabled, requireCampaignAccount, requireCampaignFeature } from "./access";
import { canTransitionCampaign, dueCampaignTransitions, isActiveCampaign } from "./state";
import { updatePendingCampaignJobs } from "./jobs";
import { ensureSendControls, sendPolicy } from "./send-budget";

type SaveOptions = { id?: string; expectedVersion?: number; appUrl: string; now: Date; graph: GraphClient; decrypt: (value: string) => string };

export async function getCampaign(db: Executor, userId: string, id: string) {
  const [campaign] = await db.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.userId, userId), isNull(campaigns.archivedAt)));
  if (!campaign || !await campaignsEnabled(db, campaign.igAccountId)) return null;
  const [products, media, audit] = await Promise.all([
    db.select().from(campaignProducts).where(and(eq(campaignProducts.campaignId, id), isNull(campaignProducts.archivedAt))).orderBy(asc(campaignProducts.sortOrder)),
    db.select().from(campaignMedia).where(eq(campaignMedia.campaignId, id)),
    db.select().from(campaignAuditEvents).where(eq(campaignAuditEvents.campaignId, id)).orderBy(desc(campaignAuditEvents.createdAt)).limit(30),
  ]);
  return { ...campaign, products, media, audit };
}

export async function listCampaigns(db: Executor, userId: string) {
  const rows = await db.select().from(campaigns).where(and(eq(campaigns.userId, userId), isNull(campaigns.archivedAt))).orderBy(desc(campaigns.createdAt));
  const flags = new Map<string, boolean>();
  for (const row of rows) if (!flags.has(row.igAccountId)) flags.set(row.igAccountId, await campaignsEnabled(db, row.igAccountId));
  return rows.filter((row) => flags.get(row.igAccountId));
}

function uniqueKeywords(values: string[]) {
  return [...new Set(values.map((value) => value.normalize("NFC").trim().toLowerCase()))];
}

async function validateFeatures(db: Executor, userId: string, input: Pick<CampaignInput, "followOnly" | "expiryFallbackEnabled">) {
  if (input.followOnly) await requireCampaignFeature(db, userId, "campaign.follow_gate");
  if (input.expiryFallbackEnabled) await requireCampaignFeature(db, userId, "campaign.scheduled_dm");
}

/** The seller lock serializes publishing across all their IG accounts. Acquire before account/campaign locks. */
async function lockSeller(db: Executor, userId: string) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`campaign-seller:${userId}`}))`);
}

async function requireActiveSlot(db: Executor, userId: string, id: string) {
  const entitlement = (await campaignEntitlements(db, userId)).get("campaign.max_active");
  if (entitlement?.kind !== "limit") throw new CampaignError("entitlement", "공구 이용 권한을 확인해주세요");
  if (entitlement.limitValue === null) return;
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(campaigns).where(and(
    eq(campaigns.userId, userId), ne(campaigns.id, id), isNull(campaigns.archivedAt),
    sql`(${campaigns.status} in ('teaser','open') or (${campaigns.status} = 'draft' and ${campaigns.publishedAt} is not null))`,
  ));
  if (count >= entitlement.limitValue) throw new CampaignError("active_limit", "동시에 진행할 수 있는 공구 수를 초과했어요");
}

async function requireMediaAvailable(db: Executor, accountId: string, id: string, mediaIds: string[]) {
  const [conflict] = await db.select({ id: campaignMedia.id }).from(campaignMedia).where(and(
    eq(campaignMedia.igAccountId, accountId), ne(campaignMedia.campaignId, id),
    eq(campaignMedia.routingEnabled, true), inArray(campaignMedia.mediaId, mediaIds),
  )).limit(1);
  if (conflict) throw new CampaignError("media_conflict", "이미 다른 공구에서 응답 중인 게시물이 있어요. 기존 공구의 연결을 먼저 해제해주세요");
}

export async function saveCampaign(db: Db, userId: string, raw: unknown, options: SaveOptions): Promise<Campaign> {
  const parsed = campaignInputSchema.safeParse(raw);
  if (!parsed.success) throw new CampaignError("validation", parsed.error.issues[0]?.message ?? "입력값을 확인해주세요");
  const input = parsed.data;
  const account = await requireCampaignAccount(db, userId, input.igAccountId);
  await validateFeatures(db, userId, input);
  for (const product of input.products) {
    const url = new URL(product.url);
    if (url.host === new URL(options.appUrl).host && /^\/(l|r)\//.test(url.pathname)) throw new CampaignError("validation", "원본 상품 링크를 입력해주세요");
  }
  // This query includes owner; access to a media ID alone is not proof of ownership.
  const media: MediaInfo[] = [];
  for (const mediaId of input.mediaIds) {
    const info = await options.graph.getMedia(options.decrypt(account.accessTokenEnc!), mediaId, { includeOwner: true });
    if (info.id !== mediaId || info.ownerId !== account.igUserId || !["FEED", "REELS"].includes(info.mediaProductType ?? "")) throw new CampaignError("media_owner", "연결한 계정의 게시물 또는 릴스만 선택할 수 있어요");
    media.push(info);
  }
  return db.transaction(async (tx) => {
    await lockSeller(tx, userId);
    await requireCampaignAccount(tx, userId, input.igAccountId);
    await validateFeatures(tx, userId, input);
    const id = options.id ?? randomUUID();
    const [old] = options.id ? await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.userId, userId))).for("update") : [];
    if (options.id && (!old || old.archivedAt)) throw new CampaignError("not_found", "공구를 찾을 수 없어요");
    if (old && old.version !== options.expectedVersion) throw new CampaignError("conflict", "다른 변경이 있어요. 새로고침 후 다시 저장해주세요");
    if (old && old.igAccountId !== account.id) throw new CampaignError("account_change", "공구의 인스타 계정은 변경할 수 없어요");
    if (old?.status === "settled") throw new CampaignError("settled", "정산 완료된 공구는 수정할 수 없어요");
    if (old && old.status !== "draft" && old.openAt.getTime() !== input.openAt.getTime() && old.status !== "teaser") throw new CampaignError("already_open", "오픈한 공구의 오픈 시각은 변경할 수 없어요");
    const rate = input.hourlyRate ?? old?.hourlyRate ?? await campaignPolicy(tx, "private_reply_default_rate");
    if (rate > await campaignPolicy(tx, "private_reply_max_rate")) throw new CampaignError("rate", "설정 가능한 발송 속도를 초과했어요");
    const fields = {
      title: input.title, brand: input.brand, openAt: input.openAt, closeAt: input.closeAt,
      notificationKeywords: uniqueKeywords(input.notificationKeywords), linkKeywords: uniqueKeywords(input.linkKeywords), excludedKeywords: uniqueKeywords(input.excludedKeywords),
      matchType: input.matchType, templates: input.templates, followOnly: input.followOnly,
      followFailurePolicy: input.followFailurePolicy, expiryFallbackEnabled: input.expiryFallbackEnabled, hourlyRate: rate,
    };
    const [saved] = old
      ? await tx.update(campaigns).set({ ...fields, version: old.version + 1 }).where(eq(campaigns.id, id)).returning()
      : await tx.insert(campaigns).values({ id, userId, igAccountId: account.id, slug: `gonggu-${id}`, ...fields }).returning();
    const oldProducts = await tx.select().from(campaignProducts).where(eq(campaignProducts.campaignId, id));
    const keptIds = new Set(input.products.flatMap((p) => p.id ? [p.id] : []));
    for (const product of oldProducts) if (!keptIds.has(product.id)) await tx.update(campaignProducts).set({ archivedAt: options.now }).where(eq(campaignProducts.id, product.id));
    for (const [index, product] of input.products.entries()) {
      const values = { name: product.name, option: product.option, originalUrl: product.url, sortOrder: index, archivedAt: null };
      if (product.id) {
        if (!oldProducts.some((p) => p.id === product.id)) throw new CampaignError("product_owner", "상품을 찾을 수 없어요");
        await tx.update(campaignProducts).set(values).where(and(eq(campaignProducts.id, product.id), eq(campaignProducts.campaignId, id)));
      } else await tx.insert(campaignProducts).values({ campaignId: id, ...values });
    }
    if (saved.publishedAt) await requireMediaAvailable(tx, account.id, id, input.mediaIds);
    await tx.delete(campaignMedia).where(eq(campaignMedia.campaignId, id));
    await tx.insert(campaignMedia).values(media.map((m) => ({ campaignId: id, igAccountId: account.id, mediaId: m.id, permalink: m.permalink, routingEnabled: Boolean(saved.publishedAt) })));
    await tx.insert(campaignAuditEvents).values({ campaignId: id, actorId: userId, action: old ? "edited" : "created", version: saved.version, requestId: randomUUID(), reason: old ? "셀러 수정" : "초안 생성", effectiveAt: options.now });
    if (old) await updatePendingCampaignJobs(tx, saved, options.now);
    return saved;
  });
}

export async function publishCampaign(db: Db, userId: string, id: string, teaser: boolean, now: Date): Promise<Campaign> {
  return db.transaction(async (tx) => {
    await lockSeller(tx, userId);
    const [campaign] = await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.userId, userId))).for("update");
    if (!campaign || campaign.archivedAt) throw new CampaignError("not_found", "공구를 찾을 수 없어요");
    await requireCampaignAccount(tx, userId, campaign.igAccountId);
    if (campaign.publishedAt) return campaign;
    if (campaign.closeAt <= now) throw new CampaignError("past_close", "마감 시각이 지났어요");
    await validateFeatures(tx, userId, campaign);
    if (teaser) await requireCampaignFeature(tx, userId, "campaign.scheduled_dm");
    await requireActiveSlot(tx, userId, id);
    const media = await tx.select().from(campaignMedia).where(eq(campaignMedia.campaignId, id));
    if (media.length === 0) throw new CampaignError("media", "게시물을 하나 이상 연결해주세요");
    await requireMediaAvailable(tx, campaign.igAccountId, id, media.map((m) => m.mediaId));
    const status = campaign.openAt <= now ? "open" : teaser ? "teaser" : "draft";
    await ensureSendControls(tx, campaign.igAccountId, now, await sendPolicy(tx), { initialPrivateRate: campaign.hourlyRate });
    const [updated] = await tx.update(campaigns).set({ publishedAt: now, status, version: campaign.version + 1, openedAt: status === "open" ? now : null }).where(eq(campaigns.id, id)).returning();
    await tx.update(campaignMedia).set({ routingEnabled: true }).where(eq(campaignMedia.campaignId, id));
    await tx.insert(campaignAuditEvents).values({ campaignId: id, actorId: userId, action: "published", fromState: "draft", toState: status, version: updated.version, requestId: "publish", reason: "셀러 공개", effectiveAt: now });
    return updated;
  });
}

async function transitionLocked(db: Executor, campaign: Campaign, to: CampaignState, now: Date, requestId: string, actorId: string | null, reason: string, effectiveAt = now) {
  if (!canTransitionCampaign(campaign.status, to)) throw new CampaignError("transition", "허용되지 않는 상태 변경이에요");
  if (!campaign.publishedAt) throw new CampaignError("unpublished", "공구를 먼저 공개해주세요");
  const [updated] = await db.update(campaigns).set({
    status: to, version: campaign.version + 1,
    ...(to === "open" ? { openedAt: now, openAt: effectiveAt } : {}),
    ...(to === "closed" || to === "sold_out" ? { closedAt: now } : {}),
    ...(to === "settled" ? { settledAt: now } : {}),
  }).where(eq(campaigns.id, campaign.id)).returning();
  await db.insert(campaignAuditEvents).values({ campaignId: campaign.id, actorId, action: "transition", fromState: campaign.status, toState: to, version: updated.version, requestId, reason, effectiveAt, createdAt: now });
  await updatePendingCampaignJobs(db, updated, now);
  if (["closed", "sold_out", "settled"].includes(to)) await queueCampaignReport(db, updated, `transition:${updated.version}`, now, to === "settled");
  return updated;
}

export async function transitionCampaign(db: Db, userId: string, id: string, to: CampaignState, options: { now: Date; requestId: string; expectedVersion: number; reason: string; acknowledgeIncomplete?: boolean }) {
  return db.transaction(async (tx) => {
    await lockSeller(tx, userId);
    const [campaign] = await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.userId, userId))).for("update");
    if (!campaign || campaign.archivedAt) throw new CampaignError("not_found", "공구를 찾을 수 없어요");
    await requireCampaignAccount(tx, userId, campaign.igAccountId);
    const [previous] = await tx.select().from(campaignAuditEvents).where(and(eq(campaignAuditEvents.campaignId, id), eq(campaignAuditEvents.requestId, options.requestId)));
    if (previous) {
      if (previous.toState !== to) throw new CampaignError("request_conflict", "같은 요청으로 다른 상태를 변경할 수 없어요");
      return campaign;
    }
    if (campaign.version !== options.expectedVersion) throw new CampaignError("conflict", "공구 상태가 변경됐어요. 새로고침해주세요");
    if (to === "teaser") await requireCampaignFeature(tx, userId, "campaign.scheduled_dm");
    if ((to === "open" || to === "teaser") && !isActiveCampaign(campaign)) await requireActiveSlot(tx, userId, id);
    if (to === "open" && options.now >= campaign.closeAt) throw new CampaignError("past_close", "마감 시각이 지났어요");
    if (to === "settled" && !options.acknowledgeIncomplete) {
      const metrics = await campaignReportMetrics(tx, id, options.now);
      if (metrics.dmPending || metrics.dmUnknown) throw new CampaignError("incomplete", "대기·확인 필요 DM이 있어요. 리포트에서 미확정 수치를 확인한 뒤 정산해주세요");
    }
    return transitionLocked(tx, campaign, to, options.now, options.requestId, userId, options.reason);
  });
}

export async function advanceDueCampaigns(db: Db, now: Date): Promise<number> {
  const due = await db.select({ id: campaigns.id, userId: campaigns.userId }).from(campaigns)
    .innerJoin(featureFlags, eq(featureFlags.key, CAMPAIGN_FLAG))
    .leftJoin(featureFlagOverrides, and(eq(featureFlagOverrides.flagKey, CAMPAIGN_FLAG), eq(featureFlagOverrides.igAccountId, campaigns.igAccountId)))
    .where(and(
    eq(featureFlags.enabled, true), sql`coalesce(${featureFlagOverrides.enabled}, ${featureFlags.defaultEnabled}) = true`,
    isNull(campaigns.archivedAt), sql`${campaigns.publishedAt} is not null`, inArray(campaigns.status, ["draft", "teaser", "open"]),
    sql`((${campaigns.status} in ('draft','teaser') and ${campaigns.openAt} <= ${now.toISOString()}::timestamptz) or (${campaigns.status} = 'open' and ${campaigns.closeAt} <= ${now.toISOString()}::timestamptz))`,
  )).limit(250);
  let transitions = 0;
  for (const row of due) transitions += await db.transaction(async (tx) => {
    await lockSeller(tx, row.userId);
    const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, row.id)).for("update");
    if (!campaign || campaign.archivedAt || !await campaignsEnabled(tx, campaign.igAccountId)) return 0;
    let current = campaign;
    const states = dueCampaignTransitions(campaign, now);
    for (const state of states) current = await transitionLocked(tx, current, state, now, `scheduled:${state}:${current.version}`, null, "예약 시각 도래", state === "open" ? current.openAt : current.closeAt);
    return states.length;
  });
  return transitions;
}

export async function archiveCampaign(db: Db, userId: string, id: string, now: Date) {
  return db.transaction(async (tx) => {
    await lockSeller(tx, userId);
    const [campaign] = await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.userId, userId))).for("update");
    if (!campaign) throw new CampaignError("not_found", "공구를 찾을 수 없어요");
    await requireCampaignAccount(tx, userId, campaign.igAccountId);
    if (campaign.archivedAt) return;
    await tx.update(campaigns).set({ archivedAt: now, version: campaign.version + 1 }).where(eq(campaigns.id, id));
    await updatePendingCampaignJobs(tx, { ...campaign, archivedAt: now }, now);
    await tx.update(campaignMedia).set({ routingEnabled: false, releasedAt: now }).where(eq(campaignMedia.campaignId, id));
    await tx.insert(campaignAuditEvents).values({ campaignId: id, actorId: userId, action: "archived", version: campaign.version + 1, requestId: "archive", reason: "셀러 종료 및 보관", effectiveAt: now });
  });
}
