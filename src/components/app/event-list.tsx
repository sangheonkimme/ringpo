import { SKIP_LABEL } from "@/lib/event-labels";
import { relativeTime } from "@/lib/time";
import type { EventRow } from "@/server/dashboard";
import { errorReasonKo } from "@/server/instagram/errors";
import { StatusBadge } from "./status-badge";

export function EventList({ events, showAutomation = true }: { events: EventRow[]; showAutomation?: boolean }) {
  if (events.length === 0) {
    return <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">아직 발송 기록이 없어요</p>;
  }
  const now = new Date();
  return (
    <ul className="overflow-hidden rounded-2xl border bg-card">
      {events.map((e) => {
        const reason = e.status === "skipped" && e.skipReason ? SKIP_LABEL[e.skipReason] : errorReasonKo(e.errorCode);
        const meta = [relativeTime(e.createdAt, now), reason || (showAutomation ? e.automationName : "")].filter(Boolean).join(" · ");
        return (
          <li key={e.id} className="flex items-start justify-between gap-3 border-b border-line-soft px-4 py-3.5 last:border-b-0">
            <div className="flex min-w-0 flex-col gap-[3px]">
              <p className="truncate text-sm">
                <strong>@{e.commenterUsername ?? "알 수 없음"}</strong> <span className="text-ink-2">{e.commentText}</span>
              </p>
              <span className="text-xs leading-normal text-muted-foreground">{meta}</span>
            </div>
            <StatusBadge status={e.status} />
          </li>
        );
      })}
    </ul>
  );
}
