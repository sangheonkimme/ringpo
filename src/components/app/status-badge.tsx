import { automationStatus, type AutomationStatusInput, type StatusTone } from "@/lib/automation-status";
import { STATUS_LABEL } from "@/lib/event-labels";
import { cn } from "@/lib/utils";
import type { EventStatus } from "@/server/db/schema";

const TONE: Record<StatusTone, string> = {
  success: "bg-success-soft text-success-ink",
  warning: "bg-warning-soft text-warning-ink",
  danger: "bg-danger-soft text-danger-ink",
  neutral: "bg-neutral-soft text-neutral-ink",
};

/** 색과 글자로 함께 상태를 알리는 배지(디자인 시스템 Badge) */
export function ToneBadge({ tone, children, className }: { tone: StatusTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-[3px] text-xs font-semibold", TONE[tone], className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

const EVENT_TONE: Record<EventStatus, StatusTone> = {
  succeeded: "success",
  partial: "warning",
  failed: "danger",
  expired: "danger",
  skipped: "neutral",
  pending: "neutral",
  processing: "neutral",
  awaiting_follow: "neutral",
};

export function StatusBadge({ status }: { status: EventStatus }) {
  return <ToneBadge tone={EVENT_TONE[status]}>{STATUS_LABEL[status]}</ToneBadge>;
}

export function AutomationStatusBadge(props: AutomationStatusInput) {
  const s = automationStatus(props);
  return <ToneBadge tone={s.tone}>{s.label}</ToneBadge>;
}
