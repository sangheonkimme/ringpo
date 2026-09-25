import { describe, expect, it } from "vitest";
import { effectivePlan } from "@/server/billing/plan-of";
import { canSubscribe, formatKrw, isUpgrade, OFFERED_PAID_PLAN_IDS, PLANS } from "@/lib/plans";
import { usagePeriod } from "@/server/usage";

describe("plans", () => {
  it("matches the spec values", () => {
    expect(PLANS.free).toMatchObject({ priceKrw: 0, maxIgAccounts: 1, maxActiveAutomations: 1, monthlyDmLimit: 300, linkTracking: false, branding: true });
    expect(PLANS.pro).toMatchObject({ priceKrw: 9900, maxIgAccounts: 1, maxActiveAutomations: null, monthlyDmLimit: 10000, linkTracking: true, branding: false });
    expect(PLANS.agency).toMatchObject({ priceKrw: 59000, maxIgAccounts: 5, maxActiveAutomations: null, monthlyDmLimit: 50000 });
  });
  it("detects upgrades by price", () => {
    expect(isUpgrade("free", "pro")).toBe(true);
    expect(isUpgrade("pro", "agency")).toBe(true);
    expect(isUpgrade("agency", "pro")).toBe(false);
  });
  it("sells only Pro to new subscribers", () => {
    expect(OFFERED_PAID_PLAN_IDS).toEqual(["pro"]);
    expect(canSubscribe("pro", "free")).toBe(true);
    expect(canSubscribe("agency", "free")).toBe(false);
    expect(canSubscribe("agency", "pro")).toBe(false);
  });
  it("lets an existing Agency subscriber keep the plan (e.g. change card)", () => {
    expect(canSubscribe("agency", "agency")).toBe(true);
  });
  it("formats KRW", () => {
    expect(formatKrw(59000)).toBe("59,000원");
  });
});

describe("effectivePlan", () => {
  it("falls back to free without a subscription or when canceled", () => {
    expect(effectivePlan(null).id).toBe("free");
    expect(effectivePlan({ plan: "pro", status: "canceled" }).id).toBe("free");
  });
  it("keeps paid features during past_due grace", () => {
    expect(effectivePlan({ plan: "pro", status: "past_due" }).id).toBe("pro");
  });
});

describe("usagePeriod", () => {
  it("uses the KST calendar month", () => {
    expect(usagePeriod(new Date("2026-09-30T14:59:59Z"))).toBe("2026-09");
    expect(usagePeriod(new Date("2026-09-30T15:00:00Z"))).toBe("2026-10");
  });
});
