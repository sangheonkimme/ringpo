import { and, asc, desc, eq, isNotNull, lte, lt, ne, sql } from "drizzle-orm";
import { campaignReportSchema, COMPARISON_METRICS, metricDifference, type CampaignReport, type ReportMetrics } from "@/lib/campaign-report";
import type { Db, Executor } from "@/server/db/client";
import { campaignClickEvents, campaignParticipants, campaignProducts, campaignReportRequests, campaigns, dmJobs, manualOrderEntries, reportSnapshots, type Campaign } from "@/server/db/schema";
import { CampaignError, campaignsEnabled } from "./access";
import { databaseNow } from "./send-budget";

export async function requireReportCampaign(db: Executor, userId: string, campaignId: string, allowDisabled = false) {
  const [campaign] = await db.select().from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)));
  if (!campaign || (!allowDisabled && !await campaignsEnabled(db, campaign.igAccountId))) throw new CampaignError("not_found", "공구 리포트를 찾을 수 없어요");
  return campaign;
}

/** Historical cutoffs use accepted jobs/events, never pre-created link rows or retry attempt counts. */
export async function campaignReportMetrics(db: Executor, campaignId: string, asOf: Date): Promise<ReportMetrics> {
  const cutoff = asOf.toISOString();
  const [[requests], [jobs], [clicks], [orders]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(campaignParticipants).where(and(eq(campaignParticipants.campaignId, campaignId), lte(campaignParticipants.notificationRequestedAt, asOf))),
    db.select({
      sent: sql<number>`(count(*) filter (where ${dmJobs.status} = 'sent' and ${dmJobs.completedAt} <= ${cutoff}::timestamptz))::int`,
      failed: sql<number>`(count(*) filter (where ${dmJobs.status} = 'failed' and ${dmJobs.completedAt} <= ${cutoff}::timestamptz))::int`,
      expired: sql<number>`(count(*) filter (where ${dmJobs.status} = 'expired' and ${dmJobs.completedAt} <= ${cutoff}::timestamptz))::int`,
      unknown: sql<number>`(count(*) filter (where ${dmJobs.status} = 'unknown' and ${dmJobs.completedAt} <= ${cutoff}::timestamptz))::int`,
      pending: sql<number>`(count(*) filter (where ${dmJobs.status} in ('waiting','retry','held','leased','sending') or ${dmJobs.completedAt} > ${cutoff}::timestamptz))::int`,
    }).from(dmJobs).where(and(eq(dmJobs.campaignId, campaignId), ne(dmJobs.channel, "public_reply"), lte(dmJobs.createdAt, asOf))),
    db.execute<{ recipients: number; total: number; unique: number; confirmed: number }>(sql`
      with delivered as (
        select distinct p.recipient_hash from dm_jobs j join campaign_participants p on p.id = j.participant_id
        where j.campaign_id = ${campaignId} and j.status = 'sent' and j.completed_at <= ${cutoff}::timestamptz
          and j.kind in ('opening_link','instant_link','follow_link')
      ), clicks as (
        select c.recipient_hash from campaign_click_events c where c.campaign_id = ${campaignId} and c.clicked_at <= ${cutoff}::timestamptz
      )
      select (select count(*)::int from delivered) as recipients, count(*)::int as total,
        count(distinct c.recipient_hash)::int as unique,
        (count(distinct c.recipient_hash) filter (where d.recipient_hash is not null))::int as confirmed
      from clicks c left join delivered d on d.recipient_hash = c.recipient_hash
    `),
    db.select().from(manualOrderEntries).where(and(eq(manualOrderEntries.campaignId, campaignId), lte(manualOrderEntries.createdAt, asOf))).orderBy(desc(manualOrderEntries.revision)).limit(1),
  ]);
  return { notificationRequests: requests.n, dmSent: jobs.sent, dmFailed: jobs.failed, dmExpired: jobs.expired, dmPending: jobs.pending, dmUnknown: jobs.unknown,
    linkRecipients: clicks.recipients, uniqueClicks: clicks.unique, totalClicks: clicks.total, confirmedUniqueClicks: clicks.confirmed, uncertainUniqueClicks: clicks.unique - clicks.confirmed,
    ctrPercent: clicks.recipients ? Math.round(clicks.confirmed / clicks.recipients * 10_000) / 100 : null,
    orders: orders?.orderCount ?? 0, revenueKrw: orders?.revenueKrw ?? 0, ordersEntered: Boolean(orders),
  };
}

/** Call inside a REPEATABLE READ transaction so each section observes the same database view. */
export async function buildCampaignReport(db: Executor, campaign: Campaign, asOf: Date, finalized: boolean): Promise<CampaignReport> {
  const cutoff = asOf.toISOString();
  const [metrics, kinds, products, hourly, [previous]] = await Promise.all([
    campaignReportMetrics(db, campaign.id, asOf),
    db.select({ kind: dmJobs.kind,
      sent: sql<number>`(count(*) filter (where ${dmJobs.status} = 'sent' and ${dmJobs.completedAt} <= ${cutoff}::timestamptz))::int`,
      failed: sql<number>`(count(*) filter (where ${dmJobs.status} = 'failed' and ${dmJobs.completedAt} <= ${cutoff}::timestamptz))::int`,
      expired: sql<number>`(count(*) filter (where ${dmJobs.status} = 'expired' and ${dmJobs.completedAt} <= ${cutoff}::timestamptz))::int`,
      unknown: sql<number>`(count(*) filter (where ${dmJobs.status} = 'unknown' and ${dmJobs.completedAt} <= ${cutoff}::timestamptz))::int`,
      pending: sql<number>`(count(*) filter (where ${dmJobs.status} in ('waiting','retry','held','leased','sending') or ${dmJobs.completedAt} > ${cutoff}::timestamptz))::int`,
    }).from(dmJobs).where(and(eq(dmJobs.campaignId, campaign.id), ne(dmJobs.channel, "public_reply"), lte(dmJobs.createdAt, asOf))).groupBy(dmJobs.kind).orderBy(asc(dmJobs.kind)),
    db.select({ name: campaignProducts.name, option: campaignProducts.option, totalClicks: sql<number>`count(${campaignClickEvents.id})::int`, uniqueClicks: sql<number>`count(distinct ${campaignClickEvents.recipientHash})::int` })
      .from(campaignProducts).leftJoin(campaignClickEvents, and(eq(campaignClickEvents.productId, campaignProducts.id), eq(campaignClickEvents.campaignId, campaign.id), lte(campaignClickEvents.clickedAt, asOf)))
      .where(eq(campaignProducts.campaignId, campaign.id)).groupBy(campaignProducts.id).orderBy(asc(campaignProducts.sortOrder), asc(campaignProducts.id)),
    db.select({ hour: sql<number>`extract(hour from ${campaignClickEvents.clickedAt} at time zone 'Asia/Seoul')::int`, clicks: sql<number>`count(*)::int` }).from(campaignClickEvents)
      .where(and(eq(campaignClickEvents.campaignId, campaign.id), lte(campaignClickEvents.clickedAt, asOf))).groupBy(sql`extract(hour from ${campaignClickEvents.clickedAt} at time zone 'Asia/Seoul')`).orderBy(sql`extract(hour from ${campaignClickEvents.clickedAt} at time zone 'Asia/Seoul')`),
    db.select().from(campaigns).where(and(eq(campaigns.userId, campaign.userId), ne(campaigns.id, campaign.id), isNotNull(campaigns.publishedAt), isNotNull(campaigns.closedAt),
      campaign.publishedAt ? lt(campaigns.publishedAt, campaign.publishedAt) : sql`false`, campaign.publishedAt ? lte(campaigns.closedAt, campaign.publishedAt) : undefined))
      .orderBy(desc(campaigns.closedAt), desc(campaigns.id)).limit(1),
  ]);
  let comparison: CampaignReport["comparison"] = null;
  if (previous?.publishedAt && campaign.publishedAt) {
    const duration = Math.max(0, asOf.getTime() - campaign.publishedAt.getTime());
    const previousCutoff = new Date(previous.publishedAt.getTime() + duration);
    const old = await campaignReportMetrics(db, previous.id, previousCutoff);
    comparison = { title: previous.title, observedDurationMs: duration, currentCutoff: cutoff, previousCutoff: previousCutoff.toISOString(), values: COMPARISON_METRICS.filter((metric) => !["orders", "revenueKrw"].includes(metric) || (metrics.ordersEntered && old.ordersEntered)).map((metric) => ({ metric, ...metricDifference(metrics[metric], old[metric]) })) };
  }
  return campaignReportSchema.parse({ schemaVersion: 1, title: campaign.title, brand: campaign.brand, publishedAt: campaign.publishedAt?.toISOString() ?? null, openedAt: campaign.openedAt?.toISOString() ?? null,
    closedAt: campaign.closedAt?.toISOString() ?? null, asOf: cutoff, finalized, metrics, dmByKind: kinds, products, hourly, comparison });
}

export async function getCampaignReport(db: Db, userId: string, campaignId: string, at?: Date) {
  return db.transaction(async (tx) => {
    const campaign = await requireReportCampaign(tx, userId, campaignId);
    const asOf = at ?? await databaseNow(tx);
    const [live, snapshots, [order], [queue]] = await Promise.all([
      buildCampaignReport(tx, campaign, asOf, false),
      tx.select({ id: reportSnapshots.id, revision: reportSnapshots.revision, asOf: reportSnapshots.asOf, finalized: reportSnapshots.finalized }).from(reportSnapshots).where(eq(reportSnapshots.campaignId, campaignId)).orderBy(desc(reportSnapshots.revision)).limit(20),
      tx.select({ revision: manualOrderEntries.revision }).from(manualOrderEntries).where(eq(manualOrderEntries.campaignId, campaignId)).orderBy(desc(manualOrderEntries.revision)).limit(1),
      tx.select({ pending: sql<number>`(count(*) filter (where ${campaignReportRequests.status} = 'waiting'))::int`, failed: sql<number>`(count(*) filter (where ${campaignReportRequests.status} = 'failed'))::int` }).from(campaignReportRequests).where(eq(campaignReportRequests.campaignId, campaignId)),
    ]);
    return { live, snapshots: snapshots.map((s) => ({ ...s, asOf: s.asOf.toISOString() })), pendingReports: queue.pending, failedReports: queue.failed, orderRevision: order?.revision ?? 0, settled: campaign.status === "settled" };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
