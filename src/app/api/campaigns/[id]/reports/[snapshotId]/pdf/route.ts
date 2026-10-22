import { z } from "zod";
import { CampaignError, requireCampaignFeature } from "@/server/campaigns/access";
import { getOwnedReportSnapshot } from "@/server/campaigns/report-operations";
import { renderReportPdf, ReportPdfBusyError } from "@/server/campaigns/report-pdf";
import { REPORT_HEADERS } from "@/server/campaigns/report-shares";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { getSessionUser } from "@/server/session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; snapshotId: string }> }) {
  const user = await getSessionUser(); if (!user) return new Response("로그인이 필요해요", { status: 401, headers: REPORT_HEADERS });
  const { id, snapshotId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(snapshotId).success) return new Response("리포트를 찾을 수 없어요", { status: 404, headers: REPORT_HEADERS });
  try {
    const db = getDb(); const saved = await getOwnedReportSnapshot(db, user.id, id, snapshotId); await requireCampaignFeature(db, user.id, "campaign.report_pdf");
    const bytes = await renderReportPdf({ cacheKey: `owner:${saved.id}`, report: saved.data, revision: saved.revision, signupUrl: new URL(`/join/${saved.referralCode}`, getEnv().APP_URL).toString() });
    await getOwnedReportSnapshot(db, user.id, id, snapshotId);
    return new Response(new Uint8Array(bytes), { headers: { ...REPORT_HEADERS, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="ringpo-report-v${saved.revision}.pdf"` } });
  } catch (error) {
    return new Response("PDF를 준비하지 못했어요", { status: error instanceof ReportPdfBusyError ? 429 : error instanceof CampaignError ? error.code === "entitlement" ? 403 : 404 : 503, headers: { ...REPORT_HEADERS, "Retry-After": "2" } });
  }
}
