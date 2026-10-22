import { notFound } from "next/navigation";
import { CampaignReportView } from "@/components/app/campaign-report-view";
import { sharedReport } from "@/server/campaigns/report-shares";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "공구 성과 리포트 · 링포", referrer: "no-referrer", robots: { index: false, follow: false } };
export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params; const shared = await sharedReport(getDb(), token); if (!shared) notFound();
  return <main className="mx-auto flex max-w-2xl flex-col gap-6 px-5 py-10">
    <p className="text-sm text-muted-foreground">공유 리포트 · 버전 {shared.revision}</p>
    <CampaignReportView report={shared.report} />
    {shared.pdfEnabled && <a href={`/reports/${token}/pdf`} rel="noreferrer" className="rounded-xl border px-5 py-3 text-center font-semibold">동일 버전 PDF 다운로드</a>}
    <footer className="border-t pt-6 text-center"><p className="mb-3 text-sm text-muted-foreground">링포로 만든 리포트</p><a href={`/join/${shared.referralCode}`} rel="noreferrer" className="inline-block rounded-xl bg-foreground px-6 py-3 font-semibold text-background">링포 가입하기</a></footer>
  </main>;
}
