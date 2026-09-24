import { Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DmAccessBanner } from "@/components/app/dm-access-banner";
import { EventList } from "@/components/app/event-list";
import { MediaThumb } from "@/components/app/media-thumb";
import { ReauthBanner } from "@/components/app/reauth-banner";
import { cn } from "@/lib/utils";
import { getDb } from "@/server/db/client";
import { getDashboard } from "@/server/dashboard";
import { requireUser } from "@/server/session";

export const metadata = { title: "홈" };

function KeywordChips({ keywords, matchType, active }: { keywords: string[]; matchType: string; active: boolean }) {
  const items = matchType === "any" ? ["모든 댓글"] : keywords;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((k) => (
        <span
          key={k}
          className={cn(
            "rounded-md px-2 py-0.5 text-xs font-semibold",
            active && matchType !== "any" ? "bg-chip text-chip-foreground" : "bg-neutral-soft text-ink-2",
          )}
        >
          {k}
        </span>
      ))}
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const d = await getDashboard(getDb(), user.id, new Date());
  if (d.accounts.length === 0) redirect("/app/onboarding");
  const usagePct = Math.min(100, Math.round((d.usage / d.plan.monthlyDmLimit) * 100));
  const primary = d.accounts[0];

  return (
    <main className="flex flex-col gap-5 px-5 pb-28 pt-5">
      <ReauthBanner accounts={d.accounts} />
      <DmAccessBanner accounts={d.accounts} />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {primary.profilePictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={primary.profilePictureUrl} alt="" className="size-10 rounded-full border-2 border-white object-cover shadow-[0_0_0_1px_var(--border)]" />
          ) : (
            <span className="size-10 rounded-full border-2 border-white bg-[#E7CFB4] shadow-[0_0_0_1px_var(--border)]" />
          )}
          <div className="flex flex-col">
            <span className="text-base font-bold">@{primary.username}</span>
            {primary.status === "active" ? (
              <span className="flex items-center gap-1.5 text-[13px] text-success-ink">
                <span className="size-[7px] rounded-full bg-success" />
                연결됨
              </span>
            ) : (
              <span className="text-[13px] text-danger-ink">다시 연결 필요</span>
            )}
          </div>
        </div>
        <span className="rounded-full bg-foreground px-3 py-1 text-xs font-bold text-white">{d.plan.name}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2.5 rounded-2xl border bg-card p-4">
          <span className="text-[13px] text-muted-foreground">이번 달 DM</span>
          <p className="flex items-baseline gap-1">
            <span className="font-display text-[28px] font-extrabold tracking-[-0.02em]">{d.usage.toLocaleString()}</span>
            <span className="text-[13px] text-muted-foreground">/ {d.plan.monthlyDmLimit.toLocaleString()}</span>
          </p>
          <div
            role="progressbar"
            aria-label="이번 달 DM 사용량"
            aria-valuenow={usagePct}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 overflow-hidden rounded-full bg-neutral-soft"
          >
            <div className="h-1.5 bg-foreground" style={{ width: `${usagePct}%` }} />
          </div>
        </div>
        <div className="flex flex-col gap-2.5 rounded-2xl border bg-card p-4">
          <span className="text-[13px] text-muted-foreground">발송 대기</span>
          <p className="flex items-baseline gap-1">
            <span className="font-display text-[28px] font-extrabold tracking-[-0.02em]">{d.waiting.toLocaleString()}</span>
            <span className="text-[13px] text-muted-foreground">건</span>
          </p>
          <span className="text-xs leading-normal text-muted-foreground">발송 한도에 맞춰 순서대로 보내요</span>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">자동화</h2>
          <Link href="/app/automations/new" className="flex h-10 items-center gap-1.5 rounded-[10px] bg-foreground px-3.5 text-sm font-semibold text-white">
            <Plus className="size-4" strokeWidth={2.4} aria-hidden />새 자동화
          </Link>
        </div>
        {d.automations.length === 0 ? (
          <Link href="/app/automations/new" className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            첫 자동화를 만들어보세요
          </Link>
        ) : (
          d.automations.map((a) => {
            const last = d.plan.linkTracking ? ["클릭", a.stats.clicks] : ["대기", a.stats.pending];
            return (
              <Link key={a.id} href={`/app/automations/${a.id}`} className="flex flex-col gap-3.5 rounded-2xl border bg-card p-4">
                <div className="flex items-center gap-3">
                  <MediaThumb url={a.mediaThumbnailUrl} scope={a.mediaScope} className="size-12" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-base font-bold">{a.name}</span>
                      {a.isActive ? (
                        <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-success-ink">
                          <span className="size-[7px] rounded-full bg-success" />
                          켜짐
                        </span>
                      ) : (
                        <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                          <span className="size-[7px] rounded-full border-[1.5px] border-muted-foreground" />
                          꺼짐
                        </span>
                      )}
                    </div>
                    <KeywordChips keywords={a.keywords} matchType={a.matchType} active={a.isActive} />
                  </div>
                </div>
                <dl className="grid grid-cols-4 gap-1.5 text-center">
                  {[
                    ["트리거", a.stats.total],
                    ["성공", a.stats.succeeded + a.stats.partial],
                    ["실패", a.stats.failed],
                    last,
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-[10px] bg-background py-2">
                      <dt className="text-[11px] text-muted-foreground">{k}</dt>
                      <dd className="mt-0.5 text-base font-bold">{Number(v).toLocaleString()}</dd>
                    </div>
                  ))}
                </dl>
              </Link>
            );
          })
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">최근 발송</h2>
        <EventList events={d.recent} />
      </section>
    </main>
  );
}
