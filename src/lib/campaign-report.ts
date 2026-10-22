import { z } from "zod";
import { CAMPAIGN_JOB_KINDS } from "./campaign-jobs";

const count = z.number().int().nonnegative().safe();
const instant = z.iso.datetime();
export const reportMetricsSchema = z.object({
  notificationRequests: count, dmSent: count, dmFailed: count, dmExpired: count, dmPending: count, dmUnknown: count,
  linkRecipients: count, uniqueClicks: count, totalClicks: count, confirmedUniqueClicks: count, uncertainUniqueClicks: count,
  ctrPercent: z.number().nonnegative().nullable(), orders: count, revenueKrw: count, ordersEntered: z.boolean(),
}).strict();
export type ReportMetrics = z.infer<typeof reportMetricsSchema>;
export const COMPARISON_METRICS = ["notificationRequests", "linkRecipients", "confirmedUniqueClicks", "totalClicks", "orders", "revenueKrw"] as const;
export type ComparisonMetric = typeof COMPARISON_METRICS[number];

/** The only data allowed into a shared report or PDF. Never spread a database row here. */
export const campaignReportSchema = z.object({
  schemaVersion: z.literal(1), title: z.string(), brand: z.string(), publishedAt: instant.nullable(), openedAt: instant.nullable(), closedAt: instant.nullable(), asOf: instant, finalized: z.boolean(),
  metrics: reportMetricsSchema,
  dmByKind: z.array(z.object({ kind: z.enum(CAMPAIGN_JOB_KINDS), sent: count, failed: count, expired: count, pending: count, unknown: count }).strict()),
  products: z.array(z.object({ name: z.string(), option: z.string(), totalClicks: count, uniqueClicks: count }).strict()),
  hourly: z.array(z.object({ hour: z.number().int().min(0).max(23), clicks: count }).strict()),
  comparison: z.object({ title: z.string(), observedDurationMs: count, currentCutoff: instant, previousCutoff: instant,
    values: z.array(z.object({ metric: z.enum(COMPARISON_METRICS), current: count, previous: count, difference: z.number().int().safe(), percent: z.number().nullable() }).strict()),
  }).strict().nullable(),
}).strict();
export type CampaignReport = z.infer<typeof campaignReportSchema>;
export const REPORT_METRIC_LABELS: Record<keyof ReportMetrics, string> = {
  notificationRequests: "알림 신청", dmSent: "DM 발송", dmFailed: "DM 실패", dmExpired: "DM 만료", dmPending: "DM 대기·처리 중", dmUnknown: "DM 확인 필요",
  linkRecipients: "구매 링크 발송", uniqueClicks: "고유 클릭", totalClicks: "전체 클릭", confirmedUniqueClicks: "확인된 링크 수신자 클릭", uncertainUniqueClicks: "발송 확인 전 링크 클릭", ctrPercent: "클릭률", ordersEntered: "주문 수치 입력 여부", orders: "주문 수 (셀러 입력)", revenueKrw: "매출 (셀러 입력)",
};
export const reportNumber = (value: number) => new Intl.NumberFormat("ko-KR").format(value);
export const reportDate = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
export function metricDifference(current: number, previous: number) { return { current, previous, difference: current - previous, percent: previous === 0 ? null : Math.round((current - previous) / previous * 10_000) / 100 }; }

export const REPORT_DM_LABELS: Record<typeof CAMPAIGN_JOB_KINDS[number], string> = { public_reply: "공개 답글", opening_link: "오픈 링크", instant_link: "즉시 링크", follow_request: "팔로우 요청", follow_reminder: "팔로우 재안내", follow_link: "팔로우 확인 링크", closed_notice: "마감 안내", faq: "FAQ", expiry_fallback: "만료 대체 안내" };

export function formatReportMetric(report: CampaignReport, key: Exclude<keyof ReportMetrics, "ordersEntered">) {
  const value = report.metrics[key];
  if (value === null || (["orders", "revenueKrw"].includes(key) && !report.metrics.ordersEntered)) return "—";
  return `${reportNumber(value)}${key === "ctrPercent" ? "%" : key === "revenueKrw" ? "원" : ""}`;
}
