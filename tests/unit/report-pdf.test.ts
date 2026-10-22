import { randomUUID } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { renderReportPdf, ReportPdfBusyError } from "@/server/campaigns/report-pdf";
import { formatReportMetric } from "@/lib/campaign-report";
import { reportData } from "../helpers/report-data";

const input = () => ({ cacheKey: randomUUID(), report: reportData(), revision: 3, signupUrl: "https://ringpo.test/join/1234567890abcdef" });
describe("actual Korean PDF output", () => {
  it("embeds readable Korean and the same numeric values as the web snapshot, including a signup link", async () => {
    const data = input(); const bytes = await renderReportPdf(data); expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    const loading = getDocument({ data: new Uint8Array(bytes), disableFontFace: true }); const pdf = await loading.promise;
    try {
      const content: string[] = []; const links: string[] = [];
      for (let n = 1; n <= pdf.numPages; n++) { const page = await pdf.getPage(n); const text = await page.getTextContent(); content.push(text.items.flatMap((i) => "str" in i ? [i.str] : []).join(" ")); links.push(...(await page.getAnnotations()).flatMap((a) => a.url ? [a.url as string] : [])); }
      const text = content.join(" ");
      for (const expected of ["가을 크림 공동구매", "보습 크림", "50ml", "링포로 만든 리포트", "1,234", "1,000", "401", "800", "50%", "1,234,567원", "버전 3"]) expect(text).toContain(expected);
      for (const metric of ["notificationRequests", "dmSent", "dmFailed", "dmExpired", "dmPending", "dmUnknown", "linkRecipients", "uniqueClicks", "totalClicks", "ctrPercent", "orders", "revenueKrw"] as const) expect(text).toContain(formatReportMetric(data.report, metric));
      expect(links).toContain(data.signupUrl); expect(text).not.toContain("recipientHash"); expect(bytes.length).toBeLessThan(2 * 1024 * 1024);
    } finally { await loading.destroy(); }
  });
  it("bounds concurrent work and caches only immutable snapshot bytes", async () => {
    const a = input(); const first = renderReportPdf(a); const second = renderReportPdf(input());
    await expect(renderReportPdf(input())).rejects.toBeInstanceOf(ReportPdfBusyError);
    const [bytes] = await Promise.all([first, second]); expect(await renderReportPdf(a)).toBe(bytes);
  });
  it("rejects a personal field before rendering", async () => {
    const data = input(); Object.assign(data.report, { instagramUsername: "private-user" }); await expect(renderReportPdf(data)).rejects.toThrow();
  });
});
