import { readFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import { campaignReportSchema, formatReportMetric, REPORT_DM_LABELS, REPORT_METRIC_LABELS, reportDate, reportNumber, type CampaignReport } from "@/lib/campaign-report";

export class ReportPdfBusyError extends Error {}
const cache = new Map<string, { bytes: Buffer; expiresAt: number }>();
let active = 0;
let font: Promise<Buffer> | undefined;
const MAX_BYTES = 2 * 1024 * 1024;

/** Trusted snapshot + bundled font only. No browser, remote resources, HTML or user-supplied URL is executed. */
export async function renderReportPdf(input: { cacheKey: string; report: CampaignReport; revision: number; signupUrl: string }) {
  const existing = cache.get(input.cacheKey); if (existing && existing.expiresAt > Date.now()) return existing.bytes;
  if (active >= 2) throw new ReportPdfBusyError("pdf_busy");
  active++;
  try {
    const report = campaignReportSchema.parse(input.report);
    const signup = new URL(input.signupUrl); if (!["https:", "http:"].includes(signup.protocol)) throw new Error("invalid_signup_url");
    font ??= readFile(path.join(process.cwd(), "src/assets/fonts/nanumgothic/NanumGothic-Regular.ttf")).catch((error) => { font = undefined; throw error; });
    const fontBytes = await font;
    const bytes = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 48, left: 48, right: 48 }, info: { Title: report.title, Author: "Ringpo", Creator: "Ringpo", CreationDate: new Date(report.asOf) } });
      doc.font(fontBytes);
      const chunks: Buffer[] = []; let size = 0;
      doc.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_BYTES) doc.destroy(new Error("report_pdf_too_large")); else chunks.push(chunk); });
      doc.on("error", reject); doc.on("end", () => resolve(Buffer.concat(chunks)));
      const line = (text: string, size = 10) => { doc.fontSize(size).fillColor("#152435").text(text, { lineGap: 4 }); };
      const heading = (text: string) => { doc.moveDown(); line(text, 14); doc.moveDown(.3); };
      try {
        line(report.brand || "공동구매 성과", 11); line(report.title, 22); doc.moveDown(.5);
        line(`버전 ${input.revision} · ${report.finalized ? "정산 확정본" : "잠정 집계"}`);
        line(`${reportDate(report.asOf)} 기준 (한국 시간)`); heading("공구 성과");
        for (const key of ["notificationRequests", "dmSent", "dmFailed", "dmExpired", "dmPending", "dmUnknown", "linkRecipients", "uniqueClicks", "totalClicks", "ctrPercent", "orders", "revenueKrw"] as const) line(`${REPORT_METRIC_LABELS[key]}: ${formatReportMetric(report, key)}`);
        doc.moveDown(); line(`클릭률: 확인된 구매 링크 수신자의 고유 클릭 ${reportNumber(report.metrics.confirmedUniqueClicks)}명 ÷ 구매 링크 발송 ${reportNumber(report.metrics.linkRecipients)}명. 최초 안내·FAQ는 분모에서 제외합니다.`, 9);
        line(`발송 확인 전 링크 고유 클릭 ${reportNumber(report.metrics.uncertainUniqueClicks)}명은 클릭률에서 제외합니다. 고유 클릭은 원 수신자 기준이며 링크 전달도 원 수신자에게 귀속됩니다. 알려진 미리보기 크롤러는 제외합니다.`, 9);
        heading("DM 종류별 결과");
        for (const k of report.dmByKind) line(`${REPORT_DM_LABELS[k.kind]}: 발송 ${k.sent} · 실패 ${k.failed} · 만료 ${k.expired} · 대기 ${k.pending} · 확인 필요 ${k.unknown}`);
        heading("상품·옵션별 클릭");
        for (const p of report.products) { line([p.name, p.option].filter(Boolean).join(" / ")); line(`고유 ${reportNumber(p.uniqueClicks)} · 전체 ${reportNumber(p.totalClicks)}`, 9); doc.moveDown(.3); }
        line("여러 상품을 누른 사람은 각 상품에 포함됩니다. 상품별 고유 클릭을 더한 값은 전체 고유 클릭과 다를 수 있습니다.", 9);
        heading("시간대별 클릭 (한국 시간)");
        line(report.hourly.length ? report.hourly.map((h) => `${String(h.hour).padStart(2, "0")}시 ${reportNumber(h.clicks)}회`).join(" / ") : "집계된 클릭이 없습니다.");
        line("보고 기간의 클릭을 하루 24개 시간대로 합산했습니다.", 9);
        if (report.comparison) {
          const c = report.comparison; heading("직전 공구 대비"); line(`${c.title} · 공개 후 ${reportNumber(Math.floor(c.observedDurationMs / 3_600_000))}시간`);
          for (const v of c.values) line(`${REPORT_METRIC_LABELS[v.metric]}: 이번 ${reportNumber(v.current)} / 이전 ${reportNumber(v.previous)} / 차이 ${v.difference > 0 ? "+" : ""}${reportNumber(v.difference)} (${v.percent === null ? "—" : `${v.percent > 0 ? "+" : ""}${reportNumber(v.percent)}%`})`);
          line(`비교 종료: 이번 ${reportDate(c.currentCutoff)} / 이전 ${reportDate(c.previousCutoff)}. 이전 0은 증감률을 계산하지 않습니다. 주문·매출은 각 종료 시각까지 입력한 수치입니다.`, 9);
        }
        heading("링포로 만든 리포트"); doc.fontSize(10).text("링포 가입하기", { link: signup.toString(), underline: true });
        line("이 파일은 표시된 시점의 저장본입니다. 이후 수정된 수치는 새 버전에서 확인해주세요.", 9);
        doc.end();
      } catch (error) { doc.destroy(error instanceof Error ? error : new Error("pdf_render_failed")); }
    });
    for (const [key, value] of cache) if (value.expiresAt <= Date.now()) cache.delete(key);
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(input.cacheKey, { bytes, expiresAt: Date.now() + 60_000 });
    return bytes;
  } finally { active--; }
}
