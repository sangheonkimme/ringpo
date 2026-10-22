import { and, desc, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import type { Db, Executor } from "@/server/db/client";
import { campaignNotificationOutbox, campaignReportRequests, campaigns, dmJobs, sendAttempts } from "@/server/db/schema";
import { isDefiniteRateRejection } from "./retry";

/** Caller must authorize the account. Counts include legacy calls sharing this account's budget. */
export async function accountOperations(db: Executor, accountId: string, campaignId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - 3_600_000);
  const [rates, errors, queue, notifications, reports, failed] = await Promise.all([
    db.select({ channel: sendAttempts.channel, invoked: sql<number>`count(*) filter (where ${sendAttempts.invokedAt} is not null)::int`, accepted: sql<number>`count(*) filter (where ${sendAttempts.state} = 'accepted')::int`, uncertain: sql<number>`count(*) filter (where ${sendAttempts.state} = 'unknown')::int` }).from(sendAttempts).where(and(eq(sendAttempts.igAccountId, accountId), gt(sendAttempts.startedAt, cutoff), lte(sendAttempts.startedAt, now))).groupBy(sendAttempts.channel),
    db.select({ code: sendAttempts.errorCode, count: sql<number>`count(*)::int` }).from(sendAttempts).where(and(eq(sendAttempts.igAccountId, accountId), gt(sendAttempts.startedAt, cutoff), lte(sendAttempts.startedAt, now), isNotNull(sendAttempts.errorCode))).groupBy(sendAttempts.errorCode).orderBy(sql`count(*) desc`).limit(20),
    db.select({ pending: sql<number>`count(*) filter (where ${dmJobs.status} in ('waiting','retry','held','leased','sending'))::int`, unknown: sql<number>`count(*) filter (where ${dmJobs.status} = 'unknown')::int`, expired: sql<number>`count(*) filter (where ${dmJobs.status} = 'expired')::int`, oldestDueAt: sql<string | null>`min(${dmJobs.nextAttemptAt}) filter (where ${dmJobs.status} in ('waiting','retry'))` }).from(dmJobs).where(eq(dmJobs.igAccountId, accountId)),
    db.select({ oldest: sql<string | null>`min(${campaignNotificationOutbox.createdAt}) filter (where ${campaignNotificationOutbox.status} in ('waiting','sending'))` }).from(campaignNotificationOutbox).where(eq(campaignNotificationOutbox.igAccountId, accountId)),
    db.select({ oldest: sql<string | null>`min(${campaignReportRequests.createdAt}) filter (where ${campaignReportRequests.status} = 'waiting')`, failed: sql<number>`count(*) filter (where ${campaignReportRequests.status} = 'failed')::int` }).from(campaignReportRequests).innerJoin(campaigns, eq(campaigns.id, campaignReportRequests.campaignId)).where(eq(campaigns.igAccountId, accountId)),
    db.select({ id: dmJobs.id, channel: dmJobs.channel, code: dmJobs.lastErrorCode, retryAllowance: dmJobs.retryAllowance }).from(dmJobs).where(and(eq(dmJobs.campaignId, campaignId), eq(dmJobs.status, "failed"))).orderBy(desc(dmJobs.updatedAt)).limit(50),
  ]);
  const age = (value: string | null) => value ? Math.max(0, Math.floor((now.getTime() - new Date(value).getTime()) / 1000)) : 0;
  return { asOf: now.toISOString(), rates, errors, queue: { ...queue[0], oldestDueAt: undefined, oldestDueSeconds: age(queue[0].oldestDueAt) }, notificationLagSeconds: age(notifications[0].oldest), reportLagSeconds: age(reports[0].oldest), failedReports: reports[0].failed,
    failedJobs: failed.map((j) => ({ id: j.id, channel: j.channel, code: j.code, retryCandidate: j.retryAllowance === 0 && isDefiniteRateRejection(j.code) })) };
}

/** Durable daily incident dedupe; flag rollback does not hide existing unknown/expired work. */
export async function queueCampaignAlerts(db: Db, now: Date) {
  const day = now.toISOString().slice(0, 10);
  const rows = await db.execute(sql`
    insert into campaign_notification_outbox (ig_account_id, user_id, key, kind, reason, next_attempt_at, created_at)
    select a.id, a.user_id, 'operations:' || a.id::text || ':' || incident.kind || ':' || ${day}, 'operations_attention',
      incident.kind || ' ' || count(*) || '건', ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz
    from (
      select ig_account_id, case when status = 'unknown' then '확인 필요' when status = 'expired' then '최근 만료' else '기한 1시간 이내 대기' end as kind
      from dm_jobs where status = 'unknown'
        or (status = 'expired' and completed_at >= ${new Date(now.getTime() - 86_400_000).toISOString()}::timestamptz)
        or (status in ('waiting','retry','held') and deadline_at <= ${new Date(now.getTime() + 3_600_000).toISOString()}::timestamptz)
    ) incident join ig_accounts a on a.id = incident.ig_account_id
    group by a.id, a.user_id, incident.kind
    on conflict (key) do nothing returning id`);
  return rows.length;
}
