import type { getCampaignForecast } from "@/server/campaigns/forecast";

export type CampaignForecast = Awaited<ReturnType<typeof getCampaignForecast>>;
const date = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
const blocked: Record<string, string> = { manual_pause: "전체 발송이 일시정지되어 있어요. 재개 후 예상 시각이 표시돼요.", policy_review: "인스타 정책 오류를 확인한 뒤 발송을 재개해주세요.", account_inactive: "인스타 계정을 다시 연결한 뒤 예상 시각을 확인해주세요.", held_jobs: "권한이나 발송 정책 확인으로 보류된 작업이 있어요.", queue_too_large: "대기 작업이 많아 현재 예상 시각을 계산할 수 없어요." };

export function CampaignForecastPanel({ forecast, preview = false }: { forecast: CampaignForecast; preview?: boolean }) {
  const unavailable = (forecast.expiredExpected ?? 0) + (forecast.closedExpected ?? 0);
  return <section aria-label="예약 발송 예상" className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-4 text-sm">
    <h3 className="font-semibold">{preview ? "변경할 일정의 발송 예상" : "예약·대기 DM 발송 예상"}</h3>
    <dl className="grid grid-cols-2 gap-3">
      <div><dt className="text-muted-foreground">현재 대기</dt><dd className="text-xl font-bold">{forecast.waiting.toLocaleString()}건</dd></div>
      <div><dt className="text-muted-foreground">7일 만료 위험</dt><dd className="text-xl font-bold">{forecast.queueRisk === null ? "최소 " : ""}{(forecast.queueRisk ?? forecast.scheduleRisk).toLocaleString()}건</dd></div>
    </dl>
    {forecast.blockedReason ? <p role="status">{blocked[forecast.blockedReason] ?? "발송 상태를 확인해주세요."}</p> : forecast.completionAt ? <p><strong>{unavailable > 0 ? "발송 가능한 신청 완료 예상" : "현재 대기 전원 발송 완료 예상"}</strong><br />{date(forecast.completionAt)} (한국 시간)</p> : <p>발송할 수 있는 대기 DM이 아직 없어요.</p>}
    {forecast.nominalCompletionAt && <p className="text-xs text-muted-foreground">대기 건수 ÷ 시간당 {forecast.effectiveHourlyRate.toLocaleString()}건의 단순 계산: {date(forecast.nominalCompletionAt)}</p>}
    {forecast.scheduleRisk > 0 && <p role="status" className="text-danger-ink">{forecast.scheduleRisk.toLocaleString()}건은 오픈 시각 전에 안전 발송 기한에 도달해요. 같은 시각인 신청도 포함해요.</p>}
    {(forecast.fallbackExpected ?? 0) > 0 && <p>약 {forecast.fallbackExpected!.toLocaleString()}건은 구매 링크 대신 오픈 일정·게시물 안내가 발송될 예정이에요. 같은 댓글에 오픈 DM을 다시 보내지 않아요.</p>}
    {(forecast.expiredExpected ?? 0) > 0 && <p role="status" className="text-danger-ink">현재 일정·대기열 기준 약 {forecast.expiredExpected!.toLocaleString()}건은 발송 전에 만료될 수 있어요.</p>}
    {(forecast.closedExpected ?? 0) > 0 && <p role="status">약 {forecast.closedExpected!.toLocaleString()}건은 마감 시각 전까지 발송하기 어려워요.</p>}
    {forecast.pauseUntil && <p>발송 제한 해제 예상: {date(forecast.pauseUntil)}</p>}
    {forecast.competingLegacy > 0 && <p>기존 자동화도 {forecast.competingLegacy.toLocaleString()}건 대기 중이에요. 처리 순서에 따라 표시한 시각보다 늦어질 수 있어요.</p>}
    {forecast.waitingMetadata > 0 && <p>댓글 시각을 확인 중인 {forecast.waitingMetadata.toLocaleString()}건은 아직 예측에 포함되지 않았어요.</p>}
    {forecast.inFlight > 0 && <p>{forecast.inFlight.toLocaleString()}건이 이미 발송 처리 중이에요.</p>}
    <p className="text-xs leading-relaxed text-muted-foreground">현재 대기열·계정 한도·발송 간격 기준의 예상이에요. 새 댓글·다른 계정의 처리량·인스타 응답 지연에 따라 바뀔 수 있어요. {forecast.latencyObserved ? "최근 발송 지연을 반영했어요." : "발송 이력이 없어 요청당 1초 지연을 가정했어요."} {preview ? "저장 전 미리보기이며" : "화면은"} 30초마다 갱신돼요.</p>
  </section>;
}
