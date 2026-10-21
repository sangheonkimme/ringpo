"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { freezeReport, saveReportOrders } from "@/app/app/campaigns/[id]/report/actions";

export function CampaignReportControls({ id, revision, orders, revenueKrw, settled, incomplete, live }: { id: string; revision: number; orders: number; revenueKrw: number; settled: boolean; incomplete: boolean; live: boolean }) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [message, setMessage] = useState("");
  useEffect(() => { if (!live) return; const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 30_000); return () => clearInterval(timer); }, [router, live]);
  function save(form: FormData) {
    startTransition(async () => {
      try { const result = await saveReportOrders({ campaignId: id, requestId: crypto.randomUUID(), expectedRevision: revision, orderCount: Number(form.get("orders")), revenueKrw: Number(form.get("revenue")), reviseFinal: form.get("revise") === "on" }); setMessage(result.ok ? "주문·매출을 저장했어요." : result.error); if (result.ok) router.refresh(); }
      catch { setMessage("저장하지 못했어요. 잠시 후 다시 확인해주세요."); }
    });
  }
  function freeze() {
    if (incomplete && !window.confirm("대기·확인 필요 DM이 있는 집계본을 저장할까요? 미확정 건수도 리포트에 표시돼요.")) return;
    startTransition(async () => {
      try { const result = await freezeReport({ campaignId: id, requestId: crypto.randomUUID(), acknowledgeIncomplete: incomplete }); if (result.ok) router.push(`/app/campaigns/${id}/report?snapshot=${result.snapshotId}`); else setMessage(result.error); }
      catch { setMessage("리포트를 저장하지 못했어요. 잠시 후 다시 확인해주세요."); }
    });
  }
  return <section aria-label="리포트 관리" className="flex flex-col gap-4 rounded-xl border bg-card p-4">
    <h2 className="font-bold">주문·매출 직접 입력</h2><p className="text-sm text-muted-foreground">이번 공구의 누적 합계예요. 고객 정보 없이 수치만 입력해주세요. 수정 이력은 보관돼요.</p>
    <form key={revision} action={save} className="flex flex-col gap-3">
      <label className="text-sm">주문 수<input className="mt-1 w-full rounded-lg border px-3 py-2" name="orders" type="number" min={0} max={1_000_000_000} required defaultValue={orders} /></label>
      <label className="text-sm">매출 (원)<input className="mt-1 w-full rounded-lg border px-3 py-2" name="revenue" type="number" min={0} max={9_000_000_000_000} required defaultValue={revenueKrw} /></label>
      {settled && <label className="flex items-start gap-2 text-sm"><input name="revise" type="checkbox" required />새 확정 리포트를 만들어요. 이전 버전·공유본의 수치는 유지돼요.</label>}
      <button disabled={pending} className="rounded-lg border px-4 py-3 text-sm font-semibold disabled:opacity-50">수치 저장</button>
    </form>
    <button disabled={pending} onClick={freeze} className="rounded-lg bg-foreground px-4 py-3 text-sm font-semibold text-background disabled:opacity-50">현재 수치로 리포트 버전 저장</button>
    <p className="text-xs text-muted-foreground">저장한 버전은 이후 클릭·수치 수정으로 바뀌지 않아요. 실시간 집계는 30초마다 갱신돼요.</p>
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
