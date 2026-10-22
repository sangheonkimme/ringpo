import type { CampaignReport } from "@/lib/campaign-report";
export function reportData(): CampaignReport {
  return { schemaVersion: 1, title: "가을 크림 공동구매", brand: "링포 브랜드", publishedAt: "2026-10-20T00:00:00.000Z", openedAt: "2026-10-21T00:00:00.000Z", closedAt: "2026-10-21T12:00:00.000Z", asOf: "2026-10-21T13:00:00.000Z", finalized: true,
    metrics: { notificationRequests: 1234, dmSent: 1000, dmFailed: 12, dmExpired: 34, dmPending: 5, dmUnknown: 6, linkRecipients: 800, uniqueClicks: 401, totalClicks: 1234, confirmedUniqueClicks: 400, uncertainUniqueClicks: 1, ctrPercent: 50, orders: 17, revenueKrw: 1234567, ordersEntered: true },
    dmByKind: [{ kind: "opening_link", sent: 800, failed: 12, expired: 34, pending: 5, unknown: 6 }, { kind: "follow_request", sent: 200, failed: 0, expired: 0, pending: 0, unknown: 0 }],
    products: [{ name: "보습 크림", option: "50ml", uniqueClicks: 401, totalClicks: 1234 }], hourly: [{ hour: 9, clicks: 1000 }, { hour: 10, clicks: 234 }],
    comparison: { title: "봄 공구", observedDurationMs: 133200000, currentCutoff: "2026-10-21T13:00:00.000Z", previousCutoff: "2026-04-21T13:00:00.000Z", values: [{ metric: "orders", current: 17, previous: 10, difference: 7, percent: 70 }] },
  };
}
