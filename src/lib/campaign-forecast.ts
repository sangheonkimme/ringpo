import { HOUR_MS, rollingWindowAvailability } from "./campaign-rate";
import { compareCampaignJobs } from "./campaign-jobs";

export interface ForecastJob {
  id: string; campaignId: string | null; scheduledAt: Date; deadlineAt: Date; hardExpiresAt: Date; commentCreatedAt: Date;
  closeAt: Date | null; opening: boolean; expiryFallback: boolean; jitterUntil: Date | null; notBefore: Date;
}
export interface ForecastInput {
  now: Date; targetCampaignId: string; targetOpenAt: Date; accountRate: number; accountNextAt: Date;
  pauseUntil: Date | null; blockedReason: string | null; jitterMs: number; permitMs: number; callMs: number;
  campaigns: { id: string; hourlyRate: number; nextAt: Date }[];
  recentCalls: { at: Date; campaignId: string | null }[];
  jobs: ForecastJob[];
}

/** Select ready jobs without sorting the entire queue after every send. */
class Heap<T> {
  private values: T[] = [];
  constructor(private compare: (a: T, b: T) => number) {}
  get size() { return this.values.length; }
  peek() { return this.values[0]; }
  push(value: T) {
    let i = this.values.length; this.values.push(value);
    while (i > 0) { const p = (i - 1) >> 1; if (this.compare(this.values[p], value) <= 0) break; this.values[i] = this.values[p]; i = p; }
    this.values[i] = value;
  }
  pop(): T | undefined {
    if (!this.size) return undefined;
    const first = this.values[0]; const last = this.values.pop()!;
    if (!this.size) return first;
    let i = 0;
    for (;;) {
      const left = i * 2 + 1; if (left >= this.size) break;
      const right = left + 1; const child = right < this.size && this.compare(this.values[right], this.values[left]) < 0 ? right : left;
      if (this.compare(last, this.values[child]) <= 0) break;
      this.values[i] = this.values[child]; i = child;
    }
    this.values[i] = last; return first;
  }
}

export interface ForecastOutcome { id: string; at: Date; state: "send" | "fallback" | "expired" | "closed" }

/** Prediction only: this function never reserves slots or authorizes a send. New arrivals/Meta latency can change it. */
export function forecastCampaignQueue(input: ForecastInput) {
  if (!Number.isFinite(input.accountRate) || input.accountRate <= 0 || input.campaigns.some((c) => !Number.isFinite(c.hourlyRate) || c.hourlyRate <= 0) || input.callMs < 0 || input.jitterMs < 0 || input.permitMs < 0) throw new Error("Invalid forecast policy");
  const target = input.jobs.filter((job) => job.campaignId === input.targetCampaignId);
  const targetRate = input.campaigns.find((c) => c.id === input.targetCampaignId)?.hourlyRate ?? input.accountRate;
  const waiting = target.length;
  const scheduleRisk = target.filter((job) => job.opening && job.scheduledAt >= job.deadlineAt).length;
  const nominalCompletionAt = waiting ? new Date(Math.max(input.now.getTime(), input.targetOpenAt.getTime()) + waiting * HOUR_MS / Math.min(input.accountRate, targetRate)) : null;
  if (input.blockedReason) return { waiting, scheduleRisk, queueRisk: null, fallbackExpected: null, expiredExpected: null, closedExpected: null, completionAt: null, nominalCompletionAt, blockedReason: input.blockedReason, outcomes: [] as ForecastOutcome[] };

  const chronological = (a: Date, b: Date) => a.getTime() - b.getTime();
  const campaign = new Map(input.campaigns.map((c) => [c.id, { rate: c.hourlyRate, next: c.nextAt.getTime(), calls: input.recentCalls.filter((a) => a.campaignId === c.id).map((a) => a.at).sort(chronological) }]));
  const calls = input.recentCalls.map((a) => a.at).sort(chronological);
  // Keep the simulated ledger bounded to the active rolling hour, even for a multi-day queue.
  const availableAt = (history: Date[], at: number, rate: number) => {
    let expired = 0;
    while (expired < history.length && history[expired].getTime() <= at - HOUR_MS - input.permitMs) expired++;
    if (expired) history.splice(0, expired);
    return rollingWindowAvailability(history, new Date(at), rate, input.permitMs).getTime();
  };
  const future = new Heap<{ job: ForecastJob; due: number }>((a, b) => a.due - b.due || compareCampaignJobs(a.job, b.job));
  const ready = new Heap<ForecastJob>(compareCampaignJobs);
  let accountNext = input.accountNextAt.getTime(); let now = Math.max(input.now.getTime(), input.pauseUntil?.getTime() ?? 0);
  for (const job of input.jobs) {
    const due = job.opening ? Math.min(job.scheduledAt.getTime(), job.deadlineAt.getTime()) : job.scheduledAt.getTime();
    future.push({ job, due: Math.max(due, job.notBefore.getTime(), job.jitterUntil?.getTime() ?? due + input.jitterMs) });
  }
  const outcomes: ForecastOutcome[] = [];
  while (future.size || ready.size) {
    now = Math.max(now, accountNext, availableAt(calls, now, input.accountRate));
    if (!ready.size && future.size) now = Math.max(now, future.peek().due);
    while (future.size && future.peek().due <= now) ready.push(future.pop()!.job);
    const job = ready.pop(); if (!job) continue;
    if (job.closeAt && job.closeAt.getTime() <= now) { outcomes.push({ id: job.id, at: new Date(now), state: "closed" }); continue; }
    const fallback = job.deadlineAt.getTime() <= now && job.opening && job.expiryFallback;
    if (job.hardExpiresAt.getTime() <= now + input.callMs || (job.deadlineAt.getTime() <= now && !fallback)) { outcomes.push({ id: job.id, at: new Date(now), state: "expired" }); continue; }
    const bucket = job.campaignId ? campaign.get(job.campaignId) : null;
    if (bucket) {
      const available = Math.max(bucket.next, availableAt(bucket.calls, now, bucket.rate));
      if (available > now) { future.push({ job, due: available }); continue; }
    }
    outcomes.push({ id: job.id, at: new Date(now), state: fallback ? "fallback" : "send" });
    calls.push(new Date(now));
    accountNext = now + Math.max(HOUR_MS / input.accountRate, input.jitterMs, input.callMs);
    if (bucket) { bucket.calls.push(new Date(now)); bucket.next = now + Math.max(HOUR_MS / bucket.rate, input.jitterMs); }
  }
  const targetIds = new Set(target.map((job) => job.id)); const own = outcomes.filter((o) => targetIds.has(o.id));
  const successful = own.filter((o) => o.state === "send" || o.state === "fallback");
  const expiredExpected = own.filter((o) => o.state === "expired").length;
  const closedExpected = own.filter((o) => o.state === "closed").length;
  const fallbackExpected = own.filter((o) => o.state === "fallback").length;
  return { waiting, scheduleRisk, queueRisk: expiredExpected + fallbackExpected, fallbackExpected, expiredExpected, closedExpected,
    completionAt: successful.length ? new Date(Math.max(...successful.map((o) => o.at.getTime())) + input.callMs) : null,
    nominalCompletionAt, blockedReason: null, outcomes,
  };
}
