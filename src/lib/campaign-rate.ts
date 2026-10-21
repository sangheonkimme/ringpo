export const HOUR_MS = 3_600_000;

export interface TokenBucketState { tokens: number; refilledAt: Date; nextEligibleAt: Date }

/** Capacity one: idle/restarting workers never accumulate a burst of permits. */
export function tokenAvailability(bucket: TokenBucketState, now: Date, hourlyRate: number): { at: Date; tokens: number } {
  if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) throw new Error("Invalid send rate");
  const interval = HOUR_MS / hourlyRate;
  const elapsed = Math.max(0, now.getTime() - bucket.refilledAt.getTime());
  const tokens = Math.min(1, bucket.tokens + elapsed / interval);
  return { tokens, at: new Date(Math.ceil(Math.max(bucket.nextEligibleAt.getTime(), Math.max(now.getTime(), bucket.refilledAt.getTime()) + (1 - tokens) * interval))) };
}

export function consumeToken(now: Date, hourlyRate: number, jitterMs: number): TokenBucketState {
  return { tokens: 0, refilledAt: now, nextEligibleAt: new Date(now.getTime() + Math.ceil(Math.max(HOUR_MS / hourlyRate, jitterMs))) };
}

export function sendJitter(minMs: number, maxMs: number, random: () => number): number {
  if (minMs < 0 || maxMs < minMs) throw new Error("Invalid jitter range");
  return minMs + Math.floor(Math.min(.999999999, Math.max(0, random())) * (maxMs - minMs + 1));
}

/** Includes the short permit lifetime so a delayed caller cannot cross the rolling-hour cap. */
export function rollingWindowAvailability(startedAt: Date[], now: Date, hourlyRate: number, permitLifetimeMs: number): Date {
  const cutoff = now.getTime() - HOUR_MS - permitLifetimeMs;
  const recent = startedAt.filter((at) => at.getTime() > cutoff).sort((a, b) => b.getTime() - a.getTime());
  return recent.length < hourlyRate ? now : new Date(recent[hourlyRate - 1].getTime() + HOUR_MS + permitLifetimeMs + 1);
}

export function nextErrorStreak(previous: { errorStreak: number; streakStartedAt: Date | null; pausedUntil: Date | null }, now: Date, windowSeconds: number) {
  const halfOpen = previous.pausedUntil !== null && previous.pausedUntil <= now;
  const withinWindow = previous.streakStartedAt !== null && now.getTime() - previous.streakStartedAt.getTime() <= windowSeconds * 1000;
  return { halfOpen, errorStreak: withinWindow ? previous.errorStreak + 1 : 1, streakStartedAt: withinWindow ? previous.streakStartedAt! : now };
}
