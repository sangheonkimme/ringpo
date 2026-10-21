import { describe, expect, it } from "vitest";
import { forecastCampaignQueue, type ForecastInput, type ForecastJob } from "@/lib/campaign-forecast";
import { campaignEditedTime } from "@/lib/campaign-schema";

const now = new Date("2026-10-21T00:00:00Z");
const at = (ms: number) => new Date(now.getTime() + ms);
function job(id: string, overrides: Partial<ForecastJob> = {}): ForecastJob {
  return { id, campaignId: "target", scheduledAt: now, notBefore: now, deadlineAt: at(7 * 86_400_000 - 3_600_000), hardExpiresAt: at(7 * 86_400_000), commentCreatedAt: now, closeAt: at(8 * 86_400_000), opening: true, expiryFallback: false, jitterUntil: null, ...overrides };
}
function input(jobs: ForecastJob[], overrides: Partial<ForecastInput> = {}): ForecastInput {
  return { now, targetCampaignId: "target", targetOpenAt: now, accountRate: 400, accountNextAt: now, pauseUntil: null, blockedReason: null, jitterMs: 5000, permitMs: 2000, callMs: 1000, campaigns: [{ id: "target", hourlyRate: 400, nextAt: now }], recentCalls: [], jobs, ...overrides };
}

describe("current-queue forecast", () => {
  it("preserves manual opening seconds when editing an unchanged minute, but converts an actual time change", () => {
    expect(campaignEditedTime("2026-10-21T09:00", "2026-10-21T00:00:07.123Z")).toBe("2026-10-21T00:00:07.123Z");
    expect(campaignEditedTime("2026-10-21T09:01", "2026-10-21T00:00:07.123Z")).toBe("2026-10-21T00:01:00.000Z");
  });
  it("keeps the requested count/rate estimate distinct from paced completion", () => {
    const result = forecastCampaignQueue(input(Array.from({ length: 12 }, (_, i) => job(String(i)))));
    expect(result.nominalCompletionAt).toEqual(at(108_000)); expect(result.completionAt).toEqual(at(105_000));
    expect(result.waiting).toBe(12); expect(result.queueRisk).toBe(0);
  });

  it("orders eligible jobs by deadline, comment time and ID, without blocking on an earlier-deadline future job", () => {
    const result = forecastCampaignQueue(input([
      job("future", { scheduledAt: at(100_000), deadlineAt: at(150_000) }),
      job("z", { deadlineAt: at(200_000), commentCreatedAt: at(1) }),
      job("b", { deadlineAt: at(200_000) }), job("a", { deadlineAt: at(200_000) }),
    ]));
    expect(result.outcomes.map((o) => o.id)).toEqual(["a", "b", "z", "future"]);
    expect(result.outcomes.at(-1)?.at).toEqual(at(105_000));
  });

  it.each([false, true])("counts opening at the exact deadline as risk, fallback=%s", (expiryFallback) => {
    const result = forecastCampaignQueue(input([job("boundary", { scheduledAt: at(10_000), deadlineAt: at(10_000), hardExpiresAt: at(3_610_000), expiryFallback })]));
    expect(result.scheduleRisk).toBe(1); expect(result.queueRisk).toBe(1);
    expect(result.outcomes[0].state).toBe(expiryFallback ? "fallback" : "expired");
    expect(result.fallbackExpected).toBe(expiryFallback ? 1 : 0);
  });

  it("includes rate backlog risk even when the opening itself precedes every deadline", () => {
    const result = forecastCampaignQueue(input([job("first", { deadlineAt: at(10_000) }), job("second", { deadlineAt: at(10_000), expiryFallback: true })]));
    expect(result.scheduleRisk).toBe(0); expect(result.queueRisk).toBe(1);
    expect(result.outcomes.map((o) => o.state)).toEqual(["send", "fallback"]);
  });

  it("cannot promise a fallback beyond the hard deadline or a link beyond campaign close", () => {
    const result = forecastCampaignQueue(input([
      job("expired", { deadlineAt: at(1000), hardExpiresAt: at(4000), expiryFallback: true }),
      job("closed", { closeAt: at(4000) }),
    ]));
    expect(result.expiredExpected).toBe(1); expect(result.closedExpected).toBe(1); expect(result.completionAt).toBeNull();
  });

  it("uses account and campaign limits independently so another campaign may fill a waiting slot", () => {
    const result = forecastCampaignQueue(input([job("target", { deadlineAt: at(100_000) }), job("other", { campaignId: "other" })], { campaigns: [{ id: "target", hourlyRate: 400, nextAt: at(60_000) }, { id: "other", hourlyRate: 400, nextAt: now }] }));
    expect(result.outcomes.map((o) => o.id)).toEqual(["other", "target"]); expect(result.completionAt).toEqual(at(61_000));
  });

  it("honors cooldown, real backoff and slower HTTP calls", () => {
    const result = forecastCampaignQueue(input([job("a", { notBefore: at(20_000) }), job("b")], { pauseUntil: at(10_000), callMs: 30_000 }));
    expect(result.outcomes.map((o) => [o.id, o.at])).toEqual([["b", at(10_000)], ["a", at(40_000)]]); expect(result.completionAt).toEqual(at(70_000));
  });

  it("keeps known schedule risk but withholds completion when manual review has no resume time", () => {
    const result = forecastCampaignQueue(input([job("risk", { scheduledAt: at(20_000), deadlineAt: at(10_000) })], { blockedReason: "manual_pause" }));
    expect(result.scheduleRisk).toBe(1); expect(result.queueRisk).toBeNull(); expect(result.completionAt).toBeNull(); expect(result.nominalCompletionAt).not.toBeNull(); expect(result.outcomes).toEqual([]);
  });

  it("projects 401 sends without crossing the rolling-hour cap, including recently used slots", () => {
    const result = forecastCampaignQueue(input(Array.from({ length: 401 }, (_, i) => job(String(i).padStart(4, "0"))), { recentCalls: [{ at: now, campaignId: null }] }));
    const starts = [now.getTime(), ...result.outcomes.map((o) => o.at.getTime())];
    for (const start of starts) expect(starts.filter((value) => value >= start && value < start + 3_600_000).length).toBeLessThanOrEqual(400);
    expect(result.outcomes.every((o) => o.state === "send")).toBe(true);
  });

  it("accounts for the conservative five-second jitter at the configured 750/h maximum", () => {
    const result = forecastCampaignQueue(input([job("a"), job("b")], { accountRate: 750, campaigns: [{ id: "target", hourlyRate: 750, nextAt: now }] }));
    expect(result.outcomes.map((o) => o.at)).toEqual([at(5000), at(10_000)]);
  });

  it("projects 3,000 pending jobs across multiple rolling hours without mutating its input", () => {
    const source = input(Array.from({ length: 3000 }, (_, i) => job(String(i).padStart(4, "0"))));
    const result = forecastCampaignQueue(source);
    expect(result.waiting).toBe(3000); expect(result.outcomes).toHaveLength(3000); expect(result.queueRisk).toBe(0);
    expect(result.completionAt!.getTime()).toBeGreaterThan(at(7 * 3_600_000).getTime());
    expect(result.completionAt!.getTime()).toBeLessThan(at(8 * 3_600_000).getTime());
    expect(source.recentCalls).toEqual([]); expect(source.accountNextAt).toEqual(now);
  });
});
