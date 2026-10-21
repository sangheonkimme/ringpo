import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Db, Executor } from "@/server/db/client";
import { accountSendControls, campaigns, dmJobs, igAccounts, sendAttempts, sendBuckets, privateReplyClaims, campaignDeliveries, type Campaign, type DmJob } from "@/server/db/schema";
import { CAMPAIGN_FLAG } from "./access";
import { ensureSendControls, releaseSendLease, sendPolicy } from "./send-budget";

export async function updatePendingCampaignJobs(db: Executor, campaign: Campaign, now: Date) {
  const pending = and(eq(dmJobs.campaignId, campaign.id), inArray(dmJobs.status, ["waiting", "retry", "held"]));
  if (campaign.archivedAt || ["closed", "sold_out", "settled"].includes(campaign.status)) {
    await db.update(dmJobs).set({ status: "canceled", completedAt: now, lastErrorCode: "campaign_closed", leaseOwner: null, leaseUntil: null })
      .where(and(pending, campaign.archivedAt ? undefined : sql`${dmJobs.kind} <> 'closed_notice'`));
    return;
  }
  await db.update(dmJobs).set({
    jitterUntil: sql`case when ${dmJobs.jitterUntil} is null then null else ${campaign.openAt.toISOString()}::timestamptz + (${dmJobs.jitterUntil} - ${dmJobs.scheduledAt}) end`,
    scheduledAt: campaign.openAt, nextAttemptAt: sql`least(${campaign.openAt.toISOString()}::timestamptz, ${dmJobs.deadlineAt})`,
  }).where(and(pending, eq(dmJobs.kind, "opening_link"), eq(dmJobs.attempts, 0), sql`${dmJobs.scheduledAt} <> ${campaign.openAt.toISOString()}::timestamptz`));
}

/** Restore only work that has not started an API attempt. Started writes become unknown. */
export async function recoverCampaignJobs(db: Db, now: Date): Promise<{ waiting: number; unknown: number }> {
  return db.transaction(async (tx) => {
    const stale = await tx.select().from(dmJobs).where(and(inArray(dmJobs.status, ["leased", "sending"]), lte(dmJobs.leaseUntil, now))).orderBy(asc(dmJobs.leaseUntil)).limit(500).for("update", { skipLocked: true });
    let waiting = 0; let unknown = 0;
    for (const job of stale) {
      const [attempt] = await tx.select().from(sendAttempts).where(and(eq(sendAttempts.jobId, job.id), eq(sendAttempts.leaseVersion, job.leaseVersion))).limit(1);
      const uncertain = job.status === "sending" || attempt?.state === "sending" || attempt?.state === "unknown";
      // A finished accepted/rejected attempt and its job outcome commit in the same transaction.
      await tx.update(dmJobs).set({ status: uncertain ? "unknown" : "waiting", leaseVersion: job.leaseVersion + 1, leaseOwner: null, leaseUntil: null, nextAttemptAt: now,
        ...(uncertain ? { lastErrorCode: "worker_lost_after_send_started", completedAt: now } : {}),
      }).where(eq(dmJobs.id, job.id));
      if (uncertain) {
        unknown++;
        await tx.update(sendAttempts).set({ state: "unknown", errorCode: "worker_lost_after_send_started", finishedAt: now }).where(and(eq(sendAttempts.jobId, job.id), eq(sendAttempts.state, "sending")));
        await tx.update(privateReplyClaims).set({ state: "unknown" }).where(eq(privateReplyClaims.jobId, job.id));
        await tx.update(campaignDeliveries).set({ state: "unknown" }).where(eq(campaignDeliveries.owningJobId, job.id));
      } else waiting++;
      if (job.leaseOwner) await releaseSendLease(tx, job.igAccountId, job.channel, job.leaseOwner);
    }
    return { waiting, unknown };
  });
}

/** Pausing or disabling sending does not stop the expiry clock. */
export async function expireCampaignJobs(db: Db, now: Date) {
  const expired = await db.update(dmJobs).set({ status: "expired", completedAt: now, lastErrorCode: "deadline_passed" }).where(and(
    inArray(dmJobs.status, ["waiting", "retry", "held"]),
    or(lte(dmJobs.hardExpiresAt, now), and(lte(dmJobs.deadlineAt, now), sql`not exists (select 1 from campaigns c where c.id = ${dmJobs.campaignId} and c.expiry_fallback_enabled and ${dmJobs.kind} in ('opening_link','expiry_fallback'))`)),
  )).returning({ id: dmJobs.id });
  return expired.length;
}

async function initializePendingBudgets(db: Db, now: Date) {
  await db.execute(sql`insert into campaign_rate_buckets (campaign_id, refilled_at, next_eligible_at)
    select c.id, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz from campaigns c
    where not exists (select 1 from campaign_rate_buckets b where b.campaign_id = c.id)
    and exists (select 1 from dm_jobs j where j.campaign_id = c.id and j.status in ('waiting','retry')) on conflict do nothing`);
  const accounts = await db.select({ id: igAccounts.id }).from(igAccounts).leftJoin(accountSendControls, eq(accountSendControls.igAccountId, igAccounts.id))
    .where(and(isNull(accountSendControls.igAccountId), sql`exists (select 1 from dm_jobs j where j.ig_account_id = ${igAccounts.id} and j.status in ('waiting','retry'))`)).limit(100);
  if (!accounts.length) return;
  const policy = await sendPolicy(db);
  for (const account of accounts) await db.transaction(async (tx) => {
    const [first] = await tx.select({ rate: campaigns.hourlyRate }).from(campaigns).where(eq(campaigns.igAccountId, account.id)).orderBy(asc(campaigns.createdAt)).limit(1);
    await ensureSendControls(tx, account.id, now, policy, { initialPrivateRate: first?.rate });
  });
}

/** Claim a channel before selecting its earliest-deadline ready job. Waiting never sleeps in a worker. */
export async function claimCampaignJobs(db: Db, options: { batch: number; now: Date; workerId: string }): Promise<DmJob[]> {
  if (options.batch <= 0) return [];
  await initializePendingBudgets(db, options.now);
  const policy = await sendPolicy(db);
  return db.transaction(async (tx) => {
    const buckets = await tx.select().from(sendBuckets).where(and(
      lte(sendBuckets.nextEligibleAt, options.now), eq(sendBuckets.requiresReview, false),
      or(isNull(sendBuckets.pausedUntil), lte(sendBuckets.pausedUntil, options.now)),
      or(isNull(sendBuckets.leaseUntil), lte(sendBuckets.leaseUntil, options.now)),
      sql`exists (select 1 from account_send_controls c join ig_accounts a on a.id = c.ig_account_id where c.ig_account_id = ${sendBuckets.igAccountId} and not c.manual_paused and a.status = 'active' and (c.warmup_until is null or c.warmup_until <= ${options.now.toISOString()}::timestamptz) and (c.api_paused_until is null or c.api_paused_until <= ${options.now.toISOString()}::timestamptz))`,
      sql`exists (select 1 from feature_flags f left join feature_flag_overrides o on o.flag_key = f.key and o.ig_account_id = ${sendBuckets.igAccountId} where f.key = ${CAMPAIGN_FLAG} and f.enabled and coalesce(o.enabled, f.default_enabled))`,
      sql`exists (select 1 from dm_jobs j where j.ig_account_id = ${sendBuckets.igAccountId} and j.channel = ${sendBuckets.channel} and j.status in ('waiting','retry') and j.next_attempt_at <= ${options.now.toISOString()}::timestamptz)`,
    )).orderBy(asc(sendBuckets.nextEligibleAt)).limit(options.batch).for("update", { skipLocked: true });
    const claimed: DmJob[] = [];
    for (const bucket of buckets) {
      const [job] = await tx.select().from(dmJobs).where(and(eq(dmJobs.igAccountId, bucket.igAccountId), eq(dmJobs.channel, bucket.channel), inArray(dmJobs.status, ["waiting", "retry"]), lte(dmJobs.nextAttemptAt, options.now)))
        .orderBy(asc(dmJobs.deadlineAt), asc(dmJobs.commentCreatedAt), asc(dmJobs.id)).limit(1).for("update", { skipLocked: true });
      if (!job) continue;
      const leaseOwner = `${options.workerId}:${randomUUID()}`;
      const leaseUntil = new Date(options.now.getTime() + policy.dispatch_lease_seconds * 1000);
      await tx.update(sendBuckets).set({ leaseOwner, leaseUntil, leaseJobId: job.id }).where(and(eq(sendBuckets.igAccountId, bucket.igAccountId), eq(sendBuckets.channel, bucket.channel)));
      const [leased] = await tx.update(dmJobs).set({ status: "leased", leaseOwner, leaseUntil, leaseVersion: job.leaseVersion + 1 }).where(eq(dmJobs.id, job.id)).returning();
      claimed.push(leased);
    }
    return claimed;
  });
}
