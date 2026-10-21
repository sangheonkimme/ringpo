"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { messageInboxOverview } from "@/server/campaigns/inbox-overview";

export function FollowInboxStatus({ overview, refresh = false }: { overview: Awaited<ReturnType<typeof messageInboxOverview>>; refresh?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!refresh) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 30_000);
    return () => clearInterval(timer);
  }, [refresh, router]);
  if (!overview.total) return null;
  return <section aria-label="팔로우 확인 답장 처리" className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
    <h3 className="font-semibold">팔로우 확인 답장 처리</h3>
    <dl className="flex flex-wrap gap-x-5 gap-y-2">{[["대기", overview.pending], ["처리 실패", overview.failed], ["확인 필요", overview.unknown], ["응답 시간 만료", overview.expired]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-bold">{value}건</dd></div>)}</dl>
    <p className="text-xs text-muted-foreground">팔로우 조회와 링크 발송 준비 상태예요. 발송 건수와 별도로 집계해요.</p>
    {overview.failed > 0 && <p role="status">처리에 실패한 답장이 있어요. 인스타 연결 상태와 발송 설정을 확인해주세요.</p>}
    {overview.unknown > 0 && <p role="status" className="text-danger-ink">발송 여부를 확인해야 해요. 이 요청은 자동으로 다시 보내지 않아요.</p>}
  </section>;
}
