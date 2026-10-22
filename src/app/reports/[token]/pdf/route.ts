import { renderReportPdf, ReportPdfBusyError } from "@/server/campaigns/report-pdf";
import { REPORT_HEADERS, sharedReport } from "@/server/campaigns/report-shares";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params; const db = getDb();
  try {
    const shared = await sharedReport(db, token);
    if (!shared?.pdfEnabled) return new Response("리포트를 찾을 수 없어요", { status: 404, headers: REPORT_HEADERS });
    const bytes = await renderReportPdf({ cacheKey: `share:${shared.id}`, report: shared.report, revision: shared.revision, signupUrl: new URL(`/join/${shared.referralCode}`, getEnv().APP_URL).toString() });
    if (!await sharedReport(db, token)) return new Response("리포트를 찾을 수 없어요", { status: 404, headers: REPORT_HEADERS });
    return new Response(new Uint8Array(bytes), { headers: { ...REPORT_HEADERS, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="ringpo-report-v${shared.revision}.pdf"` } });
  } catch (error) { return new Response("PDF를 준비하지 못했어요. 잠시 후 다시 시도해주세요", { status: error instanceof ReportPdfBusyError ? 429 : 503, headers: { ...REPORT_HEADERS, "Retry-After": "2" } }); }
}
