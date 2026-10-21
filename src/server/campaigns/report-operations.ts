import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { campaignReportSchema } from "@/lib/campaign-report";
import type { Db, Executor } from "@/server/db/client";
import { campaignReportRequests, campaigns, manualOrderEntries, reportSnapshots, type Campaign } from "@/server/db/schema";
import { CampaignError, campaignsEnabled } from "./access";
import { buildCampaignReport, campaignReportMetrics, requireReportCampaign } from "./report";
import { log } from "@/server/log";
import { databaseNow } from "./send-budget";

export async function queueCampaignReport(db: Executor, campaign: Campaign, sourceKey: string, asOf: Date, finalized = false) {
  await db.insert(campaignReportRequests).values({ campaignId: campaign.id, sourceKey, asOf, finalized, nextAttemptAt: asOf, createdAt: asOf }).onConflictDoNothing();
}

async function snapshotLocked(db: Executor, campaign: Campaign, sourceKey: string, asOf: Date, finalized: boolean) {
  const [existing] = await db.select().from(reportSnapshots).where(and(eq(reportSnapshots.campaignId, campaign.id), eq(reportSnapshots.sourceKey, sourceKey)));
  if (existing) return existing;
  const data = await buildCampaignReport(db, campaign, asOf, finalized);
  const [latest] = await db.select({ revision: reportSnapshots.revision }).from(reportSnapshots).where(eq(reportSnapshots.campaignId, campaign.id)).orderBy(desc(reportSnapshots.revision)).limit(1);
  const [snapshot] = await db.insert(reportSnapshots).values({ campaignId: campaign.id, sourceKey, asOf, finalized, revision: (latest?.revision ?? 0) + 1, data }).returning();
  return snapshot;
}

const orderInput = z.object({ campaignId: z.uuid(), requestId: z.uuid(), expectedRevision: z.number().int().nonnegative(), orderCount: z.number().int().min(0).max(1_000_000_000), revenueKrw: z.number().int().min(0).max(9_000_000_000_000), reviseFinal: z.boolean().default(false) });
export async function saveManualOrders(db: Db, userId: string, raw: unknown, at?: Date) {
  const parsed = orderInput.safeParse(raw); if (!parsed.success) throw new CampaignError("validation", "주문 수와 원 단위 매출을 확인해주세요");
  const input = parsed.data;
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(campaigns).where(and(eq(campaigns.id, input.campaignId), eq(campaigns.userId, userId))).for("update");
    if (!locked) throw new CampaignError("not_found", "공구를 찾을 수 없어요");
    const campaign = await requireReportCampaign(tx, userId, input.campaignId);
    const [same] = await tx.select().from(manualOrderEntries).where(and(eq(manualOrderEntries.campaignId, campaign.id), eq(manualOrderEntries.requestId, input.requestId)));
    if (same) {
      if (same.orderCount !== input.orderCount || same.revenueKrw !== input.revenueKrw) throw new CampaignError("request_conflict", "같은 요청으로 다른 수치를 저장할 수 없어요");
      return same.revision;
    }
    if (campaign.status === "settled" && !input.reviseFinal) throw new CampaignError("finalized", "정산 수치를 수정하려면 새 확정 리포트 만들기를 선택해주세요");
    const [latest] = await tx.select().from(manualOrderEntries).where(eq(manualOrderEntries.campaignId, campaign.id)).orderBy(desc(manualOrderEntries.revision)).limit(1);
    if ((latest?.revision ?? 0) !== input.expectedRevision) throw new CampaignError("conflict", "주문 수치가 변경됐어요. 새로고침 후 확인해주세요");
    const now = at ?? await databaseNow(tx); const revision = input.expectedRevision + 1;
    await tx.insert(manualOrderEntries).values({ campaignId: campaign.id, actorId: userId, revision, requestId: input.requestId, orderCount: input.orderCount, revenueKrw: input.revenueKrw, createdAt: now });
    if (campaign.status === "settled") await queueCampaignReport(tx, campaign, `order:${input.requestId}`, now, true);
    return revision;
  });
}

export async function createReportSnapshot(db: Db, userId: string, campaignId: string, options: { requestId: string; acknowledgeIncomplete?: boolean; now?: Date }) {
  if (!z.uuid().safeParse(options.requestId).success) throw new CampaignError("validation", "리포트 요청을 확인해주세요");
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId))).for("update");
    if (!locked) throw new CampaignError("not_found", "공구를 찾을 수 없어요");
    const campaign = await requireReportCampaign(tx, userId, campaignId);
    const sourceKey = `manual:${options.requestId}`;
    const [existing] = await tx.select().from(reportSnapshots).where(and(eq(reportSnapshots.campaignId, campaignId), eq(reportSnapshots.sourceKey, sourceKey)));
    if (existing) return { id: existing.id, revision: existing.revision };
    const now = options.now ?? await databaseNow(tx);
    if (campaign.status === "settled") {
      const metrics = await campaignReportMetrics(tx, campaignId, now);
      if ((metrics.dmPending || metrics.dmUnknown) && !options.acknowledgeIncomplete) throw new CampaignError("incomplete", "대기·확인 필요 DM이 있어요. 미확정 수치를 확인한 뒤 새 버전을 만들어주세요");
    }
    const snapshot = await snapshotLocked(tx, campaign, sourceKey, now, campaign.status === "settled");
    return { id: snapshot.id, revision: snapshot.revision };
  }, { isolationLevel: "repeatable read" });
}

export async function getOwnedReportSnapshot(db: Executor, userId: string, campaignId: string, snapshotId: string) {
  await requireReportCampaign(db, userId, campaignId);
  const [snapshot] = await db.select().from(reportSnapshots).where(and(eq(reportSnapshots.id, snapshotId), eq(reportSnapshots.campaignId, campaignId)));
  if (!snapshot) throw new CampaignError("not_found", "리포트 버전을 찾을 수 없어요");
  return { id: snapshot.id, revision: snapshot.revision, data: campaignReportSchema.parse(snapshot.data) };
}

/** Database-only work: snapshot insert and request completion commit together; no external I/O inside locks. */
export async function processCampaignReports(db: Db, now: Date, batch = 20) {
  const due = await db.select().from(campaignReportRequests).where(and(eq(campaignReportRequests.status, "waiting"), lte(campaignReportRequests.nextAttemptAt, now), sql`exists (
    select 1 from campaigns c join feature_flags f on f.key = 'gonggu_campaigns'
    left join feature_flag_overrides o on o.flag_key = f.key and o.ig_account_id = c.ig_account_id
    where c.id = ${campaignReportRequests.campaignId} and f.enabled and coalesce(o.enabled, f.default_enabled)
  )`)).orderBy(asc(campaignReportRequests.nextAttemptAt)).limit(batch);
  let completed = 0;
  for (const candidate of due) {
    try {
      completed += await db.transaction(async (tx) => {
        const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, candidate.campaignId)).for("update", { skipLocked: true });
        if (!campaign || !await campaignsEnabled(tx, campaign.igAccountId)) return 0;
        const [request] = await tx.select().from(campaignReportRequests).where(and(eq(campaignReportRequests.id, candidate.id), eq(campaignReportRequests.status, "waiting"))).for("update", { skipLocked: true });
        if (!request || request.nextAttemptAt > now) return 0;
        const snapshot = await snapshotLocked(tx, campaign, request.sourceKey, request.asOf, request.finalized);
        await tx.update(campaignReportRequests).set({ status: "done", snapshotId: snapshot.id }).where(eq(campaignReportRequests.id, request.id));
        return 1;
      }, { isolationLevel: "repeatable read" });
    } catch {
      log.error("campaign report generation failed", { campaign_id: candidate.campaignId, report_request_id: candidate.id, attempt: candidate.attempts + 1 });
      // A failed transaction leaves the request durable. Bounded retry also handles serialization races.
      await db.update(campaignReportRequests).set({ attempts: sql`${campaignReportRequests.attempts} + 1`,
        status: sql`case when ${campaignReportRequests.attempts} >= 4 then 'failed' else 'waiting' end`,
        nextAttemptAt: new Date(now.getTime() + Math.min(3_600_000, 30_000 * 2 ** candidate.attempts)),
      }).where(and(eq(campaignReportRequests.id, candidate.id), eq(campaignReportRequests.status, "waiting"), eq(campaignReportRequests.attempts, candidate.attempts)));
    }
  }
  return completed;
}
