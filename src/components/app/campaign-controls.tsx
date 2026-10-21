"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { changeCampaignAction } from "@/app/app/campaigns/actions";
import type { CampaignState } from "@/lib/campaign-schema";

export function CampaignControls({ id, version, status, published, scheduledDm }: { id: string; version: number; status: CampaignState; published: boolean; scheduledDm: boolean }) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [error, setError] = useState<string | null>(null);
  type Action = Parameters<typeof changeCampaignAction>[0]["action"];
  function run(action: Action) {
    if (["closed", "sold_out", "settled", "archive"].includes(action) && !window.confirm("공구 상태를 변경할까요? 진행 중인 발송에도 적용돼요.")) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await changeCampaignAction({ id, version, action, requestId: crypto.randomUUID() });
        if (!result.ok) { setError(result.error); return; }
        if (action === "archive") router.push("/app/campaigns");
        router.refresh();
      } catch { setError("상태를 변경하지 못했어요. 새로고침 후 확인해주세요."); }
    });
  }
  const actions: { action: Action; label: string }[] = [];
  if (!published) { actions.push({ action: "publish", label: "공개 및 오픈 예약" }); if (scheduledDm) actions.push({ action: "publish_teaser", label: "예고 시작" }); }
  else if (status === "draft" || status === "teaser") actions.push({ action: "open", label: "지금 오픈" });
  if (status === "open") actions.push({ action: "closed", label: "마감" }, { action: "sold_out", label: "품절 처리" });
  if (status === "closed" || status === "sold_out") actions.push({ action: "settled", label: "정산 확정" });
  actions.push({ action: "archive", label: "연결 해제 및 보관" });
  return <div className="flex flex-col gap-3"><div className="flex flex-wrap gap-2">{actions.map(({ action, label }) => <button type="button" key={action} disabled={pending} onClick={() => run(action)} className="rounded-xl border bg-card px-4 py-3 text-sm font-semibold disabled:opacity-50">{label}</button>)}</div>{error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}</div>;
}
