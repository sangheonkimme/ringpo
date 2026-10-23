import { SKIP_LABEL } from "@/lib/event-labels";
import { logTime } from "@/lib/time";
import type { EventRow } from "@/server/dashboard";
import { errorReasonKo } from "@/server/instagram/errors";
import { StatusBadge } from "./status-badge";

/**
 * 발송 기록을 시간순 로그로 보여 준다(디자인 A + C 의 로그 표시, 2026-10-23).
 * 왼쪽 칸은 KST 시각(오늘이 아니면 날짜를 위에), 가운데는 누가 무엇을 달았는지와 사유·자동화 이름, 오른쪽은 결과.
 */
export function EventList({ events, showAutomation = true }: { events: EventRow[]; showAutomation?: boolean }) {
  if (events.length === 0) {
    return <p className="rounded-3xl border-2 border-dashed border-input p-6 text-center text-sm text-ink-2">아직 발송 기록이 없어요</p>;
  }
  const now = new Date();
  return (
    <ol className="overflow-hidden rounded-3xl bg-card">
      {events.map((e) => {
        const reason = e.status === "skipped" && e.skipReason ? SKIP_LABEL[e.skipReason] : errorReasonKo(e.errorCode);
        const meta = reason || (showAutomation ? e.automationName : "");
        const at = logTime(e.createdAt, now);
        return (
          <li key={e.id} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-start gap-3 border-b border-line-soft px-4 py-3.5 last:border-b-0">
            <time dateTime={e.createdAt.toISOString()} className="flex flex-col pt-px text-xs font-semibold tabular-nums leading-[1.45] text-muted-foreground">
              {at.day && <span>{at.day}</span>}
              <span className="text-foreground">{at.time}</span>
            </time>
            <div className="flex min-w-0 flex-col gap-[3px]">
              <p className="truncate text-sm">
                <strong>@{e.commenterUsername ?? "알 수 없음"}</strong> <span className="text-ink-2">{e.commentText}</span>
              </p>
              {meta && <span className="text-xs leading-normal text-muted-foreground">{meta}</span>}
            </div>
            <StatusBadge status={e.status} />
          </li>
        );
      })}
    </ol>
  );
}
