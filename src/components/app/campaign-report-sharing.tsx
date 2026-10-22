"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { issueReportShare } from "@/app/app/report-shares/actions";

export function CampaignReportSharing({ campaignId, snapshotId, canShare, canPdf }: { campaignId: string; snapshotId: string | null; canShare: boolean; canPdf: boolean }) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [message, setMessage] = useState(""); const [url, setUrl] = useState("");
  function issue(form: FormData) {
    if (!snapshotId) return;
    startTransition(async () => {
      try {
        const days = Number(form.get("days"));
        const result = await issueReportShare({ campaignId, snapshotId, requestId: crypto.randomUUID(), reviewedPublicContent: form.get("reviewed") === "on", pdfEnabled: form.get("pdf") === "on", expiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null });
        if (result.ok) { setUrl(result.url); setMessage("공유 링크를 만들었어요. 지금 복사해주세요."); router.refresh(); } else setMessage(result.error);
      } catch { setMessage("공유 링크를 만들지 못했어요. 잠시 후 다시 확인해주세요."); }
    });
  }
  return <section aria-label="브랜드 리포트 공유" className="flex flex-col gap-4 rounded-xl border bg-card p-4">
    <h2 className="font-bold">브랜드에 공유하기</h2>
    {!snapshotId ? <p className="text-sm">먼저 현재 수치로 리포트 버전을 저장해주세요. 저장한 같은 버전을 웹과 PDF로 전달해요.</p> : <>
      {canPdf && <a href={`/api/campaigns/${campaignId}/reports/${snapshotId}/pdf`} className="rounded-lg border px-4 py-3 text-center text-sm font-semibold">이 버전 PDF 다운로드</a>}
      {canShare ? <form action={issue} className="flex flex-col gap-3 text-sm">
        <p>링크를 가진 사람은 로그인 없이 이 버전을 볼 수 있어요. 공유 전 위 리포트를 확인해주세요.</p>
        <label className="flex items-start gap-2"><input name="reviewed" type="checkbox" required />제목·브랜드·상품명에 개인정보가 없는지 확인했어요.</label>
        <label>링크 유효 기간<select name="days" className="mt-1 w-full rounded-lg border px-3 py-2" defaultValue="90"><option value="30">30일</option><option value="90">90일</option><option value="0">폐기할 때까지</option></select></label>
        {canPdf && <label className="flex items-center gap-2"><input name="pdf" type="checkbox" defaultChecked />브랜드도 같은 버전의 PDF 다운로드 허용</label>}
        <button disabled={pending} className="rounded-lg bg-foreground px-4 py-3 font-semibold text-background disabled:opacity-50">공유 링크 만들기</button>
      </form> : <p className="text-sm">현재 요금제에서는 브랜드 공유 링크를 만들 수 없어요.</p>}
    </>}
    {url && <div className="flex flex-col gap-2"><label className="text-sm">새 공유 링크<input aria-label="새 공유 링크" readOnly value={url} className="mt-1 w-full rounded-lg border p-2 text-sm" /></label><div className="flex gap-2"><button className="rounded-lg border px-3 py-2 text-sm" onClick={async () => { try { await navigator.clipboard.writeText(url); setMessage("링크를 복사했어요."); } catch { setMessage("입력칸의 링크를 직접 복사해주세요."); } }}>링크 복사</button><a className="rounded-lg border px-3 py-2 text-sm" href={url} target="_blank" rel="noreferrer">공유 화면 열기</a></div><p className="text-xs text-muted-foreground">이 화면을 떠나면 링크 주소를 다시 확인할 수 없어요. 목록에서 폐기하고 새로 만들 수 있어요.</p></div>}
    {message && <p role="status" className="text-sm">{message}</p>}
    <Link href="/app/report-shares" className="text-sm underline">전체 공유 링크 관리</Link>
  </section>;
}
