import { describe, expect, it } from "vitest";
import { consumeToken, nextErrorStreak, rollingWindowAvailability, sendJitter, tokenAvailability } from "@/lib/campaign-rate";
import { classifyCampaignSendError } from "@/server/campaigns/send-errors";
import { GraphApiError, GraphNetworkError } from "@/server/instagram/errors";
import { graphRateHint } from "@/server/instagram/rate-hints";

describe("campaign send budget policy", () => {
  const now = new Date("2026-10-21T00:00:00Z");
  it("refills only one token and preserves a 400/hour gap across long idle periods/restarts", () => {
    const consumed = consumeToken(now, 400, 4000);
    expect(consumed.nextEligibleAt.getTime() - now.getTime()).toBe(9000);
    const half = tokenAvailability(consumed, new Date(now.getTime() + 4500), 400);
    expect(half.tokens).toBe(.5); expect(half.at).toEqual(consumed.nextEligibleAt);
    expect(tokenAvailability(consumed, new Date(now.getTime() + 10 * 86400000), 400).tokens).toBe(1);
    expect(tokenAvailability(consumed, new Date(now.getTime() - 1000), 400).at).toEqual(consumed.nextEligibleAt);
  });
  it("applies the larger of configured interval and jitter, including after a speed decrease", () => {
    expect(consumeToken(now, 750, 5000).nextEligibleAt.getTime() - now.getTime()).toBe(5000);
    const state = consumeToken(now, 400, 3000);
    expect(tokenAvailability(state, new Date(now.getTime() + 9000), 100).at.getTime() - now.getTime()).toBe(36000);
    expect(sendJitter(3000, 5000, () => 0)).toBe(3000);
    expect(sendJitter(3000, 5000, () => .999999)).toBe(5000);
  });
  it("guards actual attempts across rolling windows with permit-delay allowance", () => {
    const calls = Array.from({ length: 400 }, (_, i) => new Date(now.getTime() - 3_600_000 + i * 9000));
    const allowed = rollingWindowAvailability(calls, now, 400, 2000);
    expect(allowed).toEqual(new Date(now.getTime() + 2001));
    expect(rollingWindowAvailability(calls, allowed, 400, 2000)).toEqual(allowed);
  });
  it("resets old streaks but recognizes a first trial after the automatic pause", () => {
    expect(nextErrorStreak({ errorStreak: 4, streakStartedAt: new Date(now.getTime() - 301000), pausedUntil: null }, now, 300).errorStreak).toBe(1);
    expect(nextErrorStreak({ errorStreak: 4, streakStartedAt: new Date(now.getTime() - 1000), pausedUntil: null }, now, 300).errorStreak).toBe(5);
    expect(nextErrorStreak({ errorStreak: 5, streakStartedAt: new Date(now.getTime() - 21600000), pausedUntil: now }, now, 300).halfOpen).toBe(true);
  });
});

describe("Meta write failures", () => {
  it.each([
    [100, 2534025, 400, "failed", null], [10, 2534022, 400, "expired", null],
    [4, undefined, 400, "retry", "rate"], [17, undefined, 400, "retry", "rate"],
    [32, undefined, 400, "retry", "rate"], [613, 2534040, 429, "retry", "rate"],
    [100, 2534029, 400, "failed", "policy"], [190, undefined, 400, "failed", "auth"],
    [200, 2534041, 400, "failed", "auth"], [1, undefined, 500, "unknown", null],
    [2, undefined, 400, "unknown", null], [undefined, undefined, 503, "unknown", null],
  ] as const)("%s/%s HTTP %s -> %s", (code, subcode, status, state, protection) => {
    expect(classifyCampaignSendError(new GraphApiError("provider text is not persisted", status, code, subcode))).toMatchObject({ state, protection });
  });
  it("never blindly retries a network failure or an unexpected write result", () => {
    expect(classifyCampaignSendError(new GraphNetworkError("timeout")).state).toBe("unknown");
    expect(classifyCampaignSendError(new Error("connection lost after acceptance")).state).toBe("unknown");
  });
});

describe("Meta rate headers", () => {
  it("reads Retry-After seconds/date and business usage percentages/minutes", () => {
    expect(graphRateHint(new Headers({ "retry-after": "120" }))).toEqual({ retryAfterMs: 120000 });
    expect(graphRateHint(new Headers({ "retry-after": "Wed, 21 Oct 2026 00:02:00 GMT" }), Date.parse("2026-10-21T00:00:00Z"))).toEqual({ retryAfterMs: 120000 });
    expect(graphRateHint(new Headers({ "x-business-use-case-usage": JSON.stringify({ account: [{ call_count: 100, total_cputime: 50, estimated_time_to_regain_access: 19 }] }) }))).toEqual({ retryAfterMs: 19 * 60000, usagePercent: 100 });
    expect(graphRateHint(new Headers({ "x-app-usage": "invalid", "retry-after": "invalid" }))).toBeUndefined();
    expect(graphRateHint(new Headers({ "retry-after": "1e100", "x-business-use-case-usage": JSON.stringify({ account: [{ estimated_time_to_regain_access: 1e300 }] }) }))).toBeUndefined();
  });
});
