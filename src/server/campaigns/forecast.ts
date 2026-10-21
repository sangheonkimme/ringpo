import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { forecastCampaignQueue, type ForecastJob } from "@/lib/campaign-forecast";
import { HOUR_MS, tokenAvailability } from "@/lib/campaign-rate";
import type { Executor } from "@/server/db/client";
import { accountSendControls, campaignRateBuckets, campaigns, commentEvents, dmJobs, igAccounts, sendAttempts, sendBuckets } from "@/server/db/schema";
import { CampaignError, campaignsEnabled } from "./access";
import { databaseNow, sendPolicy } from "./send-budget";

export interface ProposedCampaignTiming { openAt: Date; closeAt: Date; hourlyRate: number; expiryFallbackEnabled: boolean }

/** Read-only preview of the current account queue. This never changes jobs or reserves a future slot. */
export async function getCampaignForecast(db: Executor, userId: string, accountId: string, campaignId?: string, proposed?: ProposedCampaignTiming, at?: Date) {
  const [account] = await db.select().from(igAccounts).where(and(eq(igAccounts.id, accountId), eq(igAccounts.userId, userId)));
  if (!account || !await campaignsEnabled(db, accountId)) throw new CampaignError("not_found", "공구 계정을 찾을 수 없어요");
  const now = at ?? await databaseNow(db);
  const [[control], buckets, campaignRows, jobs, recent, [legacy], [routing], policy] = await Promise.all([
    db.select().from(accountSendControls).where(eq(accountSendControls.igAccountId, accountId)),
    db.select().from(sendBuckets).where(eq(sendBuckets.igAccountId, accountId)),
    db.select({ campaign: campaigns, bucket: campaignRateBuckets }).from(campaigns).leftJoin(campaignRateBuckets, eq(campaignRateBuckets.campaignId, campaigns.id)).where(eq(campaigns.igAccountId, accountId)),
    db.select().from(dmJobs).where(and(eq(dmJobs.igAccountId, accountId), eq(dmJobs.channel, "private_reply"), inArray(dmJobs.status, ["waiting", "retry", "held", "leased", "sending"]))).limit(10_001),
    db.select({ at: sendAttempts.startedAt, campaignId: sendAttempts.campaignId, state: sendAttempts.state, invokedAt: sendAttempts.invokedAt, finishedAt: sendAttempts.finishedAt }).from(sendAttempts).where(and(eq(sendAttempts.igAccountId, accountId), eq(sendAttempts.channel, "private_reply"), ne(sendAttempts.state, "not_invoked"), gt(sendAttempts.startedAt, new Date(now.getTime() - HOUR_MS - 60_000)))),
    db.select({ count: sql<number>`count(*)::int` }).from(commentEvents).where(and(eq(commentEvents.igAccountId, accountId), eq(commentEvents.routeOwner, "legacy"), inArray(commentEvents.status, ["pending", "processing"]), sql`${commentEvents.dmMessageId} is null`)),
    db.select({ count: sql<number>`count(*)::int` }).from(commentEvents).where(and(eq(commentEvents.igAccountId, accountId), inArray(commentEvents.status, ["campaign_pending", "campaign_processing"]), campaignId ? eq(commentEvents.campaignId, campaignId) : undefined)),
    sendPolicy(db),
  ]);
  const target = campaignId ? campaignRows.find((row) => row.campaign.id === campaignId)?.campaign : null;
  if (campaignId && (!target || target.userId !== userId || target.archivedAt)) throw new CampaignError("not_found", "공구를 찾을 수 없어요");
  const timing = proposed ?? (target ? { openAt: target.openAt, closeAt: target.closeAt, hourlyRate: target.hourlyRate, expiryFallbackEnabled: target.expiryFallbackEnabled } : null);
  if (!timing || timing.openAt >= timing.closeAt || timing.hourlyRate <= 0 || timing.hourlyRate > policy.private_reply_max_rate) throw new CampaignError("validation", "공구 일정과 발송 속도를 확인해주세요");
  if (proposed && target && !["draft", "teaser"].includes(target.status) && proposed.openAt.getTime() !== target.openAt.getTime()) throw new CampaignError("already_open", "오픈한 공구의 오픈 시각은 변경할 수 없어요");
  const accountRate = Math.min(control?.privateReplyRate ?? policy.private_reply_default_rate, policy.private_reply_max_rate);
  const privateBucket = buckets.find((bucket) => bucket.channel === "private_reply");
  const publicBucket = buckets.find((bucket) => bucket.channel === "public_reply");
  const own = jobs.filter((job) => job.campaignId === campaignId);
  const pending = own.filter((job) => ["waiting", "retry", "held"].includes(job.status));
  const publicStopsDm = !control?.continueDmOnPublicPause;
  const blockedReason = control?.manualPaused ? "manual_pause" : privateBucket?.requiresReview || (publicStopsDm && publicBucket?.requiresReview) ? "policy_review" :
    account.status !== "active" ? "account_inactive" : own.some((job) => job.status === "held") ? "held_jobs" : jobs.length > 10_000 ? "queue_too_large" : null;
  const pauses = [control?.warmupUntil, control?.apiPausedUntil, privateBucket?.pausedUntil, publicStopsDm ? publicBucket?.pausedUntil : null, privateBucket?.leaseUntil].filter((date): date is Date => Boolean(date && date > now));
  const pauseUntil = pauses.length ? new Date(Math.max(...pauses.map((date) => date.getTime()))) : null;
  const byId = new Map(campaignRows.map((row) => [row.campaign.id, row.campaign]));
  const queued: ForecastJob[] = jobs.filter((job) => ["waiting", "retry"].includes(job.status) || (job.status === "held" && job.campaignId === campaignId)).flatMap((job) => {
    const campaign = byId.get(job.campaignId); if (!campaign || campaign.archivedAt) return [];
    const changed = job.campaignId === campaignId && proposed;
    const opening = ["opening_link", "expiry_fallback"].includes(job.kind);
    const scheduledAt = changed && job.kind === "opening_link" ? timing.openAt : job.scheduledAt;
    // Preserve actual backoff/cooldown while previewing a changed opening schedule.
    const due = opening ? scheduledAt : new Date(Math.max(scheduledAt.getTime(), job.nextAttemptAt.getTime()));
    return [{ id: job.id, campaignId: job.campaignId, scheduledAt: due, deadlineAt: job.deadlineAt, hardExpiresAt: job.hardExpiresAt, commentCreatedAt: job.commentCreatedAt,
      closeAt: job.kind === "closed_notice" ? null : changed ? timing.closeAt : campaign.closeAt, opening,
      expiryFallback: changed ? timing.expiryFallbackEnabled : campaign.expiryFallbackEnabled,
      notBefore: changed && opening && job.attempts === 0 ? now : job.nextAttemptAt,
      jitterUntil: changed && job.jitterUntil && job.kind === "opening_link" ? new Date(timing.openAt.getTime() + job.jitterUntil.getTime() - job.scheduledAt.getTime()) : job.jitterUntil }];
  });
  const latencies = recent.filter((call) => call.state === "accepted" && call.invokedAt && call.finishedAt).map((call) => call.finishedAt!.getTime() - call.invokedAt!.getTime()).filter((ms) => ms >= 0).sort((a, b) => a - b);
  // With no observed sends use a labeled one-second transport assumption; do not call this a Meta SLA.
  const callMs = latencies[Math.max(0, Math.ceil(latencies.length * .95) - 1)] ?? 1000;
  const result = forecastCampaignQueue({ now, targetCampaignId: campaignId ?? "draft", targetOpenAt: timing.openAt, accountRate,
    accountNextAt: privateBucket ? tokenAvailability(privateBucket, now, accountRate).at : now,
    pauseUntil, blockedReason, jitterMs: policy.jitter_max_ms, permitMs: policy.send_permit_ms, callMs,
    campaigns: campaignRows.map(({ campaign, bucket }) => {
      const rate = campaign.id === campaignId ? timing.hourlyRate : campaign.hourlyRate;
      return { id: campaign.id, hourlyRate: rate, nextAt: bucket ? tokenAvailability(bucket, now, rate).at : now };
    }), recentCalls: recent.map((call) => ({ at: call.at, campaignId: call.campaignId })), jobs: queued,
  });
  let waiting = pending.length; let inFlight = own.length - pending.length; let scheduleRisk = result.scheduleRisk;
  if (jobs.length > 10_000 && campaignId) {
    // The simulation is bounded, but visible counts must never silently become counts of the truncated sample.
    const [all] = await db.select({
      waiting: sql<number>`(count(*) filter (where ${dmJobs.status} in ('waiting','retry','held')))::int`,
      inFlight: sql<number>`(count(*) filter (where ${dmJobs.status} in ('leased','sending')))::int`,
      risk: sql<number>`(count(*) filter (where ${dmJobs.status} in ('waiting','retry','held') and ${dmJobs.kind} in ('opening_link','expiry_fallback') and ${timing.openAt.toISOString()}::timestamptz >= ${dmJobs.deadlineAt}))::int`,
    }).from(dmJobs).where(and(eq(dmJobs.campaignId, campaignId), eq(dmJobs.igAccountId, accountId), eq(dmJobs.channel, "private_reply")));
    waiting = all.waiting; inFlight = all.inFlight; scheduleRisk = all.risk;
  }
  return {
    asOf: now.toISOString(), waiting, inFlight,
    scheduleRisk, queueRisk: result.queueRisk, fallbackExpected: result.fallbackExpected,
    expiredExpected: result.expiredExpected, closedExpected: result.closedExpected,
    completionAt: result.completionAt?.toISOString() ?? null, nominalCompletionAt: waiting ? new Date(Math.max(now.getTime(), timing.openAt.getTime()) + waiting * HOUR_MS / Math.min(accountRate, timing.hourlyRate)).toISOString() : null,
    blockedReason: result.blockedReason, effectiveHourlyRate: Math.min(accountRate, timing.hourlyRate), pauseUntil: pauseUntil?.toISOString() ?? null,
    competingLegacy: legacy.count, waitingMetadata: routing.count, callLatencyMs: Math.ceil(callMs), latencyObserved: latencies.length > 0,
  };
}
