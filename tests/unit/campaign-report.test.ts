import { describe, expect, it } from "vitest";
import { campaignReportSchema, metricDifference } from "@/lib/campaign-report";

describe("report aggregate contract", () => {
  it("keeps an unavailable percentage distinct from a zero-percent change", () => {
    expect(metricDifference(10, 0)).toEqual({ current: 10, previous: 0, difference: 10, percent: null });
    expect(metricDifference(10, 10).percent).toBe(0); expect(metricDifference(7, 10).percent).toBe(-30);
  });
  it("rejects personal fields at every serialized report level", () => {
    const data = { schemaVersion: 1, title: "공구", brand: "브랜드", publishedAt: null, openedAt: null, closedAt: null, asOf: "2026-10-21T00:00:00.000Z", finalized: false,
      metrics: { notificationRequests: 0, dmSent: 0, dmFailed: 0, dmExpired: 0, dmPending: 0, dmUnknown: 0, linkRecipients: 0, uniqueClicks: 0, totalClicks: 0, confirmedUniqueClicks: 0, uncertainUniqueClicks: 0, ctrPercent: null, orders: 0, revenueKrw: 0, ordersEntered: false }, dmByKind: [], products: [], hourly: [], comparison: null };
    expect(campaignReportSchema.safeParse(data).success).toBe(true);
    expect(campaignReportSchema.safeParse({ ...data, username: "private" }).success).toBe(false);
    expect(campaignReportSchema.safeParse({ ...data, products: [{ name: "상품", option: "옵션", totalClicks: 1, uniqueClicks: 1, recipientHash: "private" }] }).success).toBe(false);
  });
});
