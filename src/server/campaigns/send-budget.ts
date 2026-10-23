import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { consumeToken, HOUR_MS, LEGACY_HANDOFF_PERMIT_MS, nextErrorStreak, rollingWindowAvailability, sendJitter, tokenAvailability } from "@/lib/campaign-rate";
import { SEND_CHANNELS, type SendChannel } from "@/lib/campaign-jobs";
import type { Executor } from "@/server/db/client";
import { accountSendControls, campaignNotificationOutbox, campaignPolicies, campaignRateBuckets, commentEvents, followGates, igAccounts, sendAttempts, sendBuckets, type SendAttempt } from "@/server/db/schema";
import type { PrivateReplyMessage } from "@/server/instagram/graph";
import type { GraphRateHint } from "@/server/instagram/rate-hints";
import { SendDeferredError, SendRejectedError, SendUncertainError } from "@/server/queue/send-errors";
import { CampaignError } from "./access";
import type { SendFailure } from "./send-errors";

const POLICY_KEYS = ["private_reply_default_rate", "private_reply_max_rate", "public_reply_default_rate", "message_default_rate", "jitter_min_ms", "jitter_max_ms", "max_attempts", "breaker_streak", "breaker_window_seconds", "breaker_pause_seconds", "dispatch_lease_seconds", "send_permit_ms", "message_window_seconds", "message_safety_seconds"] as const;
export type SendPolicy = Record<(typeof POLICY_KEYS)[number], number>;

export async function sendPolicy(db: Executor): Promise<SendPolicy> {
  const rows = new Map((await db.select().from(campaignPolicies)).map((r) => [r.key, r.value]));
  const result = {} as SendPolicy;
  for (const key of POLICY_KEYS) {
    const value = rows.get(key);
    if (value === undefined) throw new CampaignError("configuration", `Missing campaign policy: ${key}`);
    result[key] = value;
  }
  if (result.dispatch_lease_seconds * 1000 < result.send_permit_ms + 20_000) throw new CampaignError("configuration", "Dispatch lease must outlive the API timeout and permit");
  return result;
}

export async function databaseNow(db: Executor): Promise<Date> {
  const rows = await db.execute<{ now: Date | string }>(sql`select clock_timestamp() as now`);
  return new Date(rows[0].now);
}

/** Old follow-ups did not have a send ledger. Unknown historical tap timing is treated conservatively. */
export async function hasUntrackedFollowCalls(db: Executor, accountId: string, now: Date) {
  const [row] = await db.select({ id: followGates.id }).from(followGates).innerJoin(commentEvents, eq(commentEvents.id, followGates.eventId))
    .where(and(eq(followGates.igAccountId, accountId), or(
      gt(followGates.lastUntrackedSendAt, new Date(now.getTime() - HOUR_MS - LEGACY_HANDOFF_PERMIT_MS)),
      and(isNull(followGates.lastUntrackedSendAt), gt(followGates.checks, 0), isNull(commentEvents.guardedJitterUntil)),
    ))).limit(1);
  return Boolean(row);
}

/** Call inside the owning transaction. No Redis or in-memory budget is involved. */
export async function ensureSendControls(db: Executor, accountId: string, now: Date, policy: SendPolicy, options: { initialPrivateRate?: number; ignoreLegacyEventId?: string } = {}) {
  const [existing] = await db.select().from(accountSendControls).where(eq(accountSendControls.igAccountId, accountId));
  if (existing) return existing;
  const [recentLegacy] = await db.select({ id: commentEvents.id }).from(commentEvents).where(and(
    eq(commentEvents.igAccountId, accountId), eq(commentEvents.routeOwner, "legacy"),
    options.ignoreLegacyEventId ? ne(commentEvents.id, options.ignoreLegacyEventId) : undefined,
    or(gt(commentEvents.dmReservedAt, new Date(now.getTime() - HOUR_MS)), eq(commentEvents.status, "processing")),
  )).limit(1);
  const recentFollow = await hasUntrackedFollowCalls(db, accountId, now);
  await db.insert(accountSendControls).values({
    igAccountId: accountId, privateReplyRate: Math.min(options.initialPrivateRate ?? policy.private_reply_default_rate, policy.private_reply_max_rate),
    publicReplyRate: policy.public_reply_default_rate, messageRate: policy.message_default_rate,
    warmupUntil: recentLegacy || recentFollow ? new Date(now.getTime() + HOUR_MS + Math.max(policy.send_permit_ms, LEGACY_HANDOFF_PERMIT_MS)) : null,
  }).onConflictDoNothing();
  await db.insert(sendBuckets).values(SEND_CHANNELS.map((channel) => ({ igAccountId: accountId, channel, refilledAt: now, nextEligibleAt: now }))).onConflictDoNothing();
  const [control] = await db.select().from(accountSendControls).where(eq(accountSendControls.igAccountId, accountId));
  return control;
}

export function channelRate(control: typeof accountSendControls.$inferSelect, channel: SendChannel): number {
  return channel === "private_reply" ? control.privateReplyRate : channel === "public_reply" ? control.publicReplyRate : control.messageRate;
}

function bucketWhere(accountId: string, channel: SendChannel) { return and(eq(sendBuckets.igAccountId, accountId), eq(sendBuckets.channel, channel)); }

export interface PermitInput {
  igAccountId: string; channel: SendChannel; logicalKey: string; leaseOwner: string; leaseVersion: number;
  jobId?: string; campaignId?: string; campaignRate?: number; legacyEventId?: string; sourceMessageEventId?: string;
  payload: PrivateReplyMessage; now: Date; extendSafety: boolean; retryAllowance?: number;
}

export type Permit = { cached: true; providerMessageId: string } | { cached: false; attempt: SendAttempt };

/** Locks the channel, checks both token and rolling-call budgets, and writes BEFORE the API call. */
export async function acquireSendPermit(db: Executor, input: PermitInput, policy: SendPolicy, random: () => number): Promise<Permit> {
  const now = input.now;
  const [accountControl] = await db.select({ control: accountSendControls, status: igAccounts.status }).from(accountSendControls)
    .innerJoin(igAccounts, eq(igAccounts.id, accountSendControls.igAccountId)).where(eq(accountSendControls.igAccountId, input.igAccountId)).for("update", { of: accountSendControls });
  const control = accountControl?.control;
  if (!control) throw new CampaignError("configuration", "Send controls must be initialized in a committed transaction");
  if (input.campaignId && !control.lastObservedEnabled) {
    // Close the race where OFF->ON occurred after the dispatcher's transition observation.
    // The caller catches this inside its transaction so the conservative warmup commits.
    const until = new Date(now.getTime() + HOUR_MS + Math.max(policy.send_permit_ms, LEGACY_HANDOFF_PERMIT_MS));
    await db.update(accountSendControls).set({ lastObservedEnabled: true, warmupUntil: until }).where(eq(accountSendControls.igAccountId, input.igAccountId));
    throw new SendDeferredError(until, "reactivation_race_warmup");
  }
  if (accountControl.status !== "active" || control.manualPaused) throw new SendDeferredError(new Date(now.getTime() + 60_000), "account_paused");
  for (const until of [control.warmupUntil, control.apiPausedUntil]) if (until && until > now) throw new SendDeferredError(until, "account_budget_pause");
  const [bucket] = await db.select().from(sendBuckets).where(bucketWhere(input.igAccountId, input.channel)).for("update");
  if (bucket.requiresReview) throw new SendDeferredError(new Date(now.getTime() + 60_000), "policy_review");
  if (bucket.pausedUntil && bucket.pausedUntil > now) throw new SendDeferredError(bucket.pausedUntil, "channel_paused");
  if (input.channel !== "public_reply" && !control.continueDmOnPublicPause) {
    const [publicBucket] = await db.select().from(sendBuckets).where(bucketWhere(input.igAccountId, "public_reply"));
    if (publicBucket.requiresReview) throw new SendDeferredError(new Date(now.getTime() + 60_000), "public_policy_review");
    if (publicBucket.pausedUntil && publicBucket.pausedUntil > now) throw new SendDeferredError(publicBucket.pausedUntil, "public_channel_paused");
  }
  if (bucket.leaseUntil && bucket.leaseUntil > now && bucket.leaseOwner !== input.leaseOwner) throw new SendDeferredError(bucket.leaseUntil, "channel_in_flight");
  const [history] = await db.select({ previous: sendAttempts, calledAttempts: sql<number>`(count(*) filter (where ${sendAttempts.state} <> 'not_invoked') over ())::int` }).from(sendAttempts).where(eq(sendAttempts.logicalKey, input.logicalKey)).orderBy(desc(sendAttempts.attempt)).limit(1);
  const previous = history?.previous;
  if (previous?.state === "accepted" && previous.providerMessageId) return { cached: true, providerMessageId: previous.providerMessageId };
  if (previous && ["sending", "unknown"].includes(previous.state)) throw new SendUncertainError(previous.errorCode ?? "previous_attempt_unresolved");
  if ((history?.calledAttempts ?? 0) >= policy.max_attempts + (input.campaignId && input.jobId ? input.retryAllowance ?? 0 : 0)) throw new SendRejectedError(previous?.errorCode ?? "max_attempts");

  const rate = input.channel === "private_reply" ? Math.min(control.privateReplyRate, policy.private_reply_max_rate) : channelRate(control, input.channel);
  const cutoff = new Date(now.getTime() - HOUR_MS - policy.send_permit_ms);
  const recent = await db.select({ at: sendAttempts.startedAt, campaignId: sendAttempts.campaignId }).from(sendAttempts).where(and(eq(sendAttempts.igAccountId, input.igAccountId), eq(sendAttempts.channel, input.channel), gt(sendAttempts.startedAt, cutoff), ne(sendAttempts.state, "not_invoked")));
  let eligible = Math.max(tokenAvailability(bucket, now, rate).at.getTime(), rollingWindowAvailability(recent.map((r) => r.at), now, rate, policy.send_permit_ms).getTime());
  if (input.campaignId && input.campaignRate && input.channel === "private_reply") {
    const [campaignBucket] = await db.select().from(campaignRateBuckets).where(eq(campaignRateBuckets.campaignId, input.campaignId)).for("update");
    if (!campaignBucket) throw new CampaignError("configuration", "Campaign budget must be initialized before dispatch");
    eligible = Math.max(eligible, tokenAvailability(campaignBucket, now, input.campaignRate).at.getTime(), rollingWindowAvailability(recent.filter((r) => r.campaignId === input.campaignId).map((r) => r.at), now, input.campaignRate, policy.send_permit_ms).getTime());
  }
  if (eligible > now.getTime()) throw new SendDeferredError(new Date(eligible), "rate_budget");
  const gap = sendJitter(policy.jitter_min_ms, policy.jitter_max_ms, random);
  await db.update(sendBuckets).set({ ...consumeToken(now, rate, gap), leaseOwner: input.leaseOwner, leaseUntil: new Date(now.getTime() + policy.dispatch_lease_seconds * 1000), leaseJobId: input.jobId ?? null }).where(bucketWhere(input.igAccountId, input.channel));
  if (input.campaignId && input.campaignRate && input.channel === "private_reply") await db.update(campaignRateBuckets).set(consumeToken(now, input.campaignRate, gap)).where(eq(campaignRateBuckets.campaignId, input.campaignId));
  if (input.extendSafety) await db.update(accountSendControls).set({ safetyUntil: new Date(now.getTime() + HOUR_MS + policy.send_permit_ms) }).where(eq(accountSendControls.igAccountId, input.igAccountId));
  const [attempt] = await db.insert(sendAttempts).values({
    id: randomUUID(), igAccountId: input.igAccountId, campaignId: input.campaignId, jobId: input.jobId, legacyEventId: input.legacyEventId, sourceMessageEventId: input.sourceMessageEventId,
    logicalKey: input.logicalKey, channel: input.channel, attempt: (previous?.attempt ?? 0) + 1,
    leaseOwner: input.leaseOwner, leaseVersion: input.leaseVersion, startedAt: now, permitExpiresAt: new Date(now.getTime() + policy.send_permit_ms),
    requestFingerprint: createHash("sha256").update(JSON.stringify(input.payload)).digest("hex"), payload: input.payload,
  }).returning();
  return { cached: false, attempt };
}

export async function releaseSendLease(db: Executor, accountId: string, channel: SendChannel, owner: string) {
  await db.update(sendBuckets).set({ leaseOwner: null, leaseUntil: null, leaseJobId: null }).where(and(bucketWhere(accountId, channel), eq(sendBuckets.leaseOwner, owner)));
}

export async function observeRateHint(db: Executor, accountId: string, hint: GraphRateHint | undefined, now: Date) {
  if (!hint || (!(hint.retryAfterMs && hint.retryAfterMs > 0) && (hint.usagePercent ?? 0) < 100)) return;
  const until = new Date(now.getTime() + Math.max(hint.retryAfterMs ?? 0, 60_000));
  await db.update(accountSendControls).set({ apiPausedUntil: sql`greatest(coalesce(${accountSendControls.apiPausedUntil}, ${now.toISOString()}::timestamptz), ${until.toISOString()}::timestamptz)` }).where(eq(accountSendControls.igAccountId, accountId));
}

/** One outbox record per automatic pause transition, committed with the breaker. */
export async function recordSendHealth(db: Executor, attempt: SendAttempt, failure: SendFailure | null, now: Date, policy: SendPolicy) {
  if (!failure) {
    await db.update(sendBuckets).set({ errorStreak: 0, streakStartedAt: null, pausedUntil: null, lastErrorCode: null, leaseOwner: null, leaseUntil: null, leaseJobId: null }).where(and(bucketWhere(attempt.igAccountId, attempt.channel), eq(sendBuckets.leaseOwner, attempt.leaseOwner)));
    return;
  }
  await db.select({ id: accountSendControls.igAccountId }).from(accountSendControls).where(eq(accountSendControls.igAccountId, attempt.igAccountId)).for("update");
  const [bucket] = await db.select().from(sendBuckets).where(bucketWhere(attempt.igAccountId, attempt.channel)).for("update");
  if (failure.protection === "auth") {
    const [account] = await db.update(igAccounts).set({ status: "reauth_required" }).where(and(eq(igAccounts.id, attempt.igAccountId), eq(igAccounts.status, "active"))).returning();
    if (account) await db.insert(campaignNotificationOutbox).values({ igAccountId: account.id, userId: account.userId, key: `reauth:${attempt.id}`, kind: "reauth_required", reason: failure.code, nextAttemptAt: now }).onConflictDoNothing();
  }
  if (failure.protection !== "rate" && failure.protection !== "policy") {
    await db.update(sendBuckets).set({ errorStreak: 0, streakStartedAt: null }).where(bucketWhere(attempt.igAccountId, attempt.channel));
    return;
  }
  const next = nextErrorStreak(bucket, now, policy.breaker_window_seconds);
  const pause = failure.protection === "policy" || next.halfOpen || next.errorStreak >= policy.breaker_streak;
  const pausedUntil = pause ? new Date(now.getTime() + Math.max(policy.breaker_pause_seconds * 1000, failure.retryAfterMs ?? 0)) : bucket.pausedUntil;
  await db.update(sendBuckets).set({ errorStreak: next.errorStreak, streakStartedAt: next.streakStartedAt, pausedUntil, requiresReview: bucket.requiresReview || failure.protection === "policy", lastErrorCode: failure.code,
    ...(failure.retryAfterMs ? { nextEligibleAt: new Date(Math.max(bucket.nextEligibleAt.getTime(), now.getTime() + failure.retryAfterMs)) } : {}),
  }).where(bucketWhere(attempt.igAccountId, attempt.channel));
  if (pause) {
    if (attempt.channel !== "public_reply") {
      // Protection errors on any send channel stop automatic public replies too.
      // Revoke a public permit's bucket ownership so its later success cannot erase this newer pause.
      await db.update(sendBuckets).set({
        pausedUntil: sql`greatest(${sendBuckets.pausedUntil}, ${pausedUntil!.toISOString()}::timestamptz)`,
        requiresReview: sql`${sendBuckets.requiresReview} or ${failure.protection === "policy"}`,
        errorStreak: sql`greatest(${sendBuckets.errorStreak}, ${policy.breaker_streak})`, streakStartedAt: now,
        lastErrorCode: failure.code, leaseOwner: null, leaseUntil: null, leaseJobId: null,
      }).where(bucketWhere(attempt.igAccountId, "public_reply"));
    }
    const [account] = await db.select().from(igAccounts).where(eq(igAccounts.id, attempt.igAccountId));
    await db.insert(campaignNotificationOutbox).values({ igAccountId: account.id, userId: account.userId, key: `send-pause:${attempt.id}`, kind: "account_paused", reason: failure.code, resumeAt: failure.protection === "policy" ? null : pausedUntil, nextAttemptAt: now }).onConflictDoNothing();
  }
}
