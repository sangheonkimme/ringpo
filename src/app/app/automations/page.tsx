import { Plus } from "lucide-react";
import Link from "next/link";
import { AutomationToggle } from "@/components/app/automation-toggle";
import { EmptyAutomations } from "@/components/app/empty-automations";
import { MediaThumb } from "@/components/app/media-thumb";
import { AutomationStatusBadge } from "@/components/app/status-badge";
import { SCOPE_LABEL } from "@/lib/automation-status";
import { keywordSummary } from "@/lib/event-labels";
import { listAutomations } from "@/server/automations/service";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";

export const metadata = { title: "자동화" };

export default async function AutomationsPage() {
  const user = await requireUser();
  const autos = await listAutomations(getDb(), user.id);
  return (
    <main className="flex flex-col gap-4 px-5 pb-28 pt-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-[28px] font-extrabold tracking-[-0.03em]">자동화</h1>
        <Link href="/app/automations/new" className="flex h-11 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-semibold text-white">
          <Plus className="size-4" strokeWidth={2.4} aria-hidden />새 자동화
        </Link>
      </div>
      {autos.length === 0 ? (
        <EmptyAutomations />
      ) : (
        <ul className="overflow-hidden rounded-2xl border bg-card">
          {autos.map((a) => (
            <li key={a.id} className="flex items-center gap-3 border-b border-line-soft py-3.5 pl-4 pr-3 last:border-b-0">
              <MediaThumb url={a.mediaThumbnailUrl} scope={a.mediaScope} className="size-[52px]" />
              <Link href={`/app/automations/${a.id}`} className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-base font-bold">{a.name}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <AutomationStatusBadge isActive={a.isActive} mediaScope={a.mediaScope} accountStatus={a.accountStatus} />
                  <span className="truncate text-[13px] text-muted-foreground">
                    {SCOPE_LABEL[a.mediaScope]} · {keywordSummary(a.keywords, a.matchType)}
                  </span>
                </span>
              </Link>
              <AutomationToggle id={a.id} active={a.isActive} label={a.name} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        댓글 하나에는 자동화 하나만 반응해요. 특정 게시물용이 먼저, 같은 범위에선 키워드 자동화가 ‘모든 댓글’보다 먼저예요.
      </p>
    </main>
  );
}
