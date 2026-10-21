import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CampaignReportView } from "@/components/app/campaign-report-view";
import { CampaignReportControls } from "@/components/app/campaign-report-controls";
import { reportDate } from "@/lib/campaign-report";
import { CampaignError } from "@/server/campaigns/access";
import { getCampaignReport } from "@/server/campaigns/report";
import { getOwnedReportSnapshot } from "@/server/campaigns/report-operations";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";

export const metadata = { title: "공구 성과 리포트" };
export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ snapshot?: string }> }) {
  const user = await requireUser(); const { id } = await params; const { snapshot } = await searchParams;
  if (!z.uuid().safeParse(id).success || (snapshot && !z.uuid().safeParse(snapshot).success)) notFound();
  const db = getDb();
  const [overview, saved] = await Promise.all([
    getCampaignReport(db, user.id, id), snapshot ? getOwnedReportSnapshot(db, user.id, id, snapshot) : null,
  ]).catch((error) => { if (error instanceof CampaignError && error.code === "not_found") notFound(); throw error; });
    return <main className="flex flex-col gap-6 px-5 pb-28 pt-5">
      <Link href={`/app/campaigns/${id}`} className="text-sm text-muted-foreground">← 공구 운영</Link>
      <nav aria-label="리포트 버전" className="flex flex-wrap gap-2 text-sm"><Link className="rounded-lg border px-3 py-2" href={`/app/campaigns/${id}/report`}>실시간 집계</Link>{overview.snapshots.map((s) => <Link className="rounded-lg border px-3 py-2" key={s.id} href={`/app/campaigns/${id}/report?snapshot=${s.id}`}>버전 {s.revision} · {s.finalized ? "확정" : "잠정"} · {reportDate(s.asOf)}</Link>)}</nav>
      {overview.pendingReports > 0 && <p role="status" className="text-sm">자동 리포트 {overview.pendingReports}개를 생성 중이에요.</p>}
      {overview.failedReports > 0 && <p role="alert" className="text-sm text-danger-ink">자동 리포트 {overview.failedReports}개를 생성하지 못했어요. 실시간 수치를 확인한 뒤 새 버전을 저장할 수 있어요.</p>}
      {saved && <p className="text-sm font-semibold">저장한 버전 {saved.revision}</p>}
      <CampaignReportView report={saved?.data ?? overview.live} />
      <CampaignReportControls id={id} revision={overview.orderRevision} orders={overview.live.metrics.orders} revenueKrw={overview.live.metrics.revenueKrw} settled={overview.settled} incomplete={overview.live.metrics.dmPending + overview.live.metrics.dmUnknown > 0} live={!saved} />
    </main>;
}
