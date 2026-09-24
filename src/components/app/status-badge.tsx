import { STATUS_LABEL } from "@/lib/event-labels";
import { cn } from "@/lib/utils";
import type { EventStatus } from "@/server/db/schema";

const TONE: Record<EventStatus, string> = {
  succeeded: "bg-success-soft text-success-ink",
  partial: "bg-warning-soft text-warning-ink",
  failed: "bg-danger-soft text-danger-ink",
  expired: "bg-danger-soft text-danger-ink",
  skipped: "bg-neutral-soft text-neutral-ink",
  pending: "border text-ink-2",
  processing: "border text-ink-2",
};

export function StatusBadge({ status }: { status: EventStatus }) {
  return (
    <span className={cn("shrink-0 rounded-full px-2.5 py-[3px] text-xs font-semibold", TONE[status])}>{STATUS_LABEL[status]}</span>
  );
}
