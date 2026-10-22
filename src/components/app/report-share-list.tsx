"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeReportShare } from "@/app/app/report-shares/actions";
import { reportDate } from "@/lib/campaign-report";
import type { listReportShares } from "@/server/campaigns/report-shares";

export function ReportShareList({ items }: { items: Awaited<ReturnType<typeof listReportShares>>["items"] }) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [message, setMessage] = useState("");
  function revoke(id: string) {
    if (!window.confirm("공유 링크를 폐기할까요? 이후 웹과 PDF 다운로드가 차단돼요. 이미 내려받은 PDF는 회수되지 않아요.")) return;
    startTransition(async () => {
      try { const result = await removeReportShare(id); setMessage(result.ok ? "공유 링크를 폐기했어요." : result.error); if (result.ok) router.refresh(); }
      catch { setMessage("폐기하지 못했어요. 새로고침 후 다시 확인해주세요."); }
    });
  }
  return <section aria-label="발급한 공유 링크" className="flex flex-col gap-3"><h2 className="font-bold">발급한 공유 링크</h2>
    {items.length ? <ul className="flex flex-col gap-3">{items.map((item) => <li key={item.id} className="rounded-xl border bg-card p-4 text-sm"><p className="font-semibold">{item.title} · 버전 {item.revision}</p><p className="mt-1 text-muted-foreground">발급 {reportDate(item.createdAt)} · {item.pdfEnabled ? "PDF 포함" : "웹 리포트"}</p><p className="mt-1">가입 유입 {item.signups}명{item.expiresAt && ` · 만료 ${reportDate(item.expiresAt)}`}</p>{item.revokedAt ? <p className="mt-3 text-muted-foreground">폐기됨 · {reportDate(item.revokedAt)}</p> : <button disabled={pending} onClick={() => revoke(item.id)} className="mt-3 rounded-lg border px-4 py-2 disabled:opacity-50">공유 폐기</button>}</li>)}</ul> : <p className="text-sm text-muted-foreground">발급한 공유 링크가 없어요.</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
