"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryCampaignJobAction, saveCampaignSendSettings } from "@/app/app/campaigns/actions";
import type { getSendOverview } from "@/server/campaigns/send-controls";
import { FollowInboxStatus } from "./follow-inbox-status";
import { CampaignForecastPanel } from "./campaign-forecast-panel";

type Overview = Awaited<ReturnType<typeof getSendOverview>>;
const date = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
const channels = { private_reply: "댓글 DM", public_reply: "공개 답글", message: "대화 DM" };

export function CampaignSendPanel({ id, overview }: { id: string; overview: Overview }) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [message, setMessage] = useState("");
  useEffect(() => { const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 30_000); return () => clearInterval(timer); }, [router]);
  const counts = overview.counts;
  const review = overview.buckets.some((b) => b.requiresReview);
  function save(form: FormData) {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await saveCampaignSendSettings(id, { expectedVersion: overview.version, requestId: crypto.randomUUID(), manualPaused: form.get("paused") === "on", privateReplyRate: Number(form.get("rate")), continueDmOnPublicPause: form.get("continueDm") === "on", acknowledgePolicyReview: form.get("review") === "on" });
        setMessage(result.ok ? "발송 설정을 저장했어요." : result.error);
        if (result.ok) router.refresh();
      } catch { setMessage("저장하지 못했어요. 새로고침 후 확인해주세요."); }
    });
  }
  function retry(jobId: string) {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await retryCampaignJobAction({ campaignId: id, jobId, requestId: crypto.randomUUID() });
        setMessage(result.ok ? "재처리를 예약했어요. 계정 속도 제한과 일시정지 설정이 적용돼요." : result.error);
        if (result.ok) router.refresh();
      } catch { setMessage("처리 결과를 확인하지 못했어요. 새로고침해주세요."); }
    });
  }
  return <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
    <h2 className="text-lg font-bold">발송 현황</h2>
    <p className="text-sm text-muted-foreground">공개 답글과 DM 작업의 합계예요. 화면은 30초마다 갱신돼요.</p>
    <p className="text-sm">추적 링크 클릭 · 고유 {overview.clicks.unique}명 / 전체 {overview.clicks.total}회</p>
    <p className="text-xs text-muted-foreground">고유 클릭은 링크를 받은 사람 기준이에요. 전달된 링크의 클릭도 원래 수신자에게 포함돼요.</p>
    <dl className="grid grid-cols-3 gap-3 text-sm">{[
      ["대기", (counts.waiting ?? 0) + (counts.retry ?? 0) + (counts.held ?? 0)], ["발송 중", (counts.leased ?? 0) + (counts.sending ?? 0)],
      ["완료", counts.sent ?? 0], ["실패", counts.failed ?? 0], ["만료", counts.expired ?? 0], ["확인 필요", counts.unknown ?? 0],
    ].map(([label, count]) => <div key={label} className="rounded-lg bg-muted p-3"><dt>{label}</dt><dd className="mt-1 text-xl font-bold">{count}</dd></div>)}</dl>
    {(counts.unknown ?? 0) > 0 && <p role="status" className="text-sm text-danger-ink">발송 결과를 확인해야 하는 작업이 있어요. 중복 발송을 막기 위해 자동으로 다시 보내지 않아요.</p>}
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-semibold">계정 운영 지표·실패 작업</summary>
      <p className="mt-3 text-xs text-muted-foreground">이 계정의 모든 공구와 기존 자동화를 포함한 최근 1시간 수치예요. 확인 필요 건은 호출 여부나 결과가 확정되지 않았을 수 있어요.</p>
      <ul className="my-3 space-y-1">{overview.operations.rates.map((r) => <li key={r.channel}>{channels[r.channel]} · 호출 확인 {r.invoked}회 / 성공 {r.accepted}회 / 확인 필요 {r.uncertain}회</li>)}</ul>
      <p>계정 대기 {overview.operations.queue.pending}건 · 가장 오래 지연된 대기 {overview.operations.queue.oldestDueSeconds}초</p>
      <p>알림 대기 {overview.operations.notificationLagSeconds}초 · 리포트 대기 {overview.operations.reportLagSeconds}초 · 리포트 실패 {overview.operations.failedReports}건</p>
      {overview.operations.errors.length > 0 && <ul className="my-3 space-y-1" aria-label="최근 오류 코드">{overview.operations.errors.map((e) => <li key={e.code}>{e.code}: {e.count}회</li>)}</ul>}
      {overview.operations.failedJobs.length > 0 && <><h3 className="mt-3 font-semibold">최근 실패 작업 (최대 50개)</h3><p className="my-2 text-xs text-muted-foreground">확정된 일시 거부만 한 번 더 재처리할 수 있어요. 기한과 발송 기록은 다시 확인해요.</p><ul className="space-y-2">{overview.operations.failedJobs.map((j) => <li key={j.id} className="flex items-center justify-between gap-2 rounded border p-2"><span>{channels[j.channel]} · {j.code ?? "오류"}</span>{j.retryCandidate && <button type="button" disabled={pending} onClick={() => retry(j.id)} className="shrink-0 rounded border px-3 py-2 disabled:opacity-50">재처리</button>}</li>)}</ul></>}
    </details>
    {message && <p role="status" className="text-sm">{message}</p>}
    <FollowInboxStatus overview={overview.inbox} campaign />
    <CampaignForecastPanel forecast={overview.forecast} />
    {overview.failedNotifications > 0 && <p role="status" className="text-sm text-danger-ink">계정 보호 알림 이메일을 보내지 못했어요. 아래 중지 상태를 확인해주세요.</p>}
    {overview.buckets.filter((b) => b.pausedUntil || b.requiresReview).map((b) => <p key={b.channel} className="text-sm">{channels[b.channel]}: {b.requiresReview ? "정책 오류 확인 필요" : `자동 중지 · ${date(b.pausedUntil!)} 이후 재시도`} {b.lastErrorCode && `(${b.lastErrorCode})`}</p>)}
    <form action={save} key={overview.version} className="mt-2 flex flex-col gap-3 border-t pt-4">
      <h3 className="font-semibold">이 인스타 계정의 발송 설정</h3>
      <label className="flex items-center gap-2 text-sm"><input name="paused" type="checkbox" defaultChecked={overview.manualPaused} />전체 자동 발송 일시정지</label>
      <p className="text-xs text-muted-foreground">이 계정의 모든 공구에 적용돼요. 이미 전송을 시작한 메시지는 완료될 수 있어요.</p>
      <label className="flex items-center justify-between gap-3 text-sm">댓글 DM 시간당 최대 건수<input name="rate" aria-label="댓글 DM 시간당 최대 건수" type="number" min={1} max={overview.maxPrivateRate} defaultValue={overview.privateReplyRate} required className="w-24 rounded-lg border bg-background px-3 py-2" /></label>
      <p className="text-xs text-muted-foreground">계정 전체 한도와 각 공구의 속도 중 더 낮은 값이 적용돼요.</p>
      <label className="flex items-center gap-2 text-sm"><input name="continueDm" type="checkbox" defaultChecked={overview.continueDmOnPublicPause} />공개 답글 자동 중지 중에도 DM 계속 보내기</label>
      {review && <label className="flex items-start gap-2 text-sm"><input name="review" type="checkbox" />Meta 정책 오류 원인을 확인했고, 대기 시간이 끝나면 발송을 재개합니다.</label>}
      <button disabled={pending} className="rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background disabled:opacity-50">{pending ? "저장 중…" : "발송 설정 저장"}</button>
    </form>
  </section>;
}
