import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutomationToggle } from "@/components/app/automation-toggle";
import { DeleteAutomationButton } from "@/components/app/delete-automation-button";
import { EventList } from "@/components/app/event-list";
import { MediaThumb } from "@/components/app/media-thumb";
import { AutomationStatusBadge } from "@/components/app/status-badge";
import { SCOPE_LABEL } from "@/lib/automation-status";
import { cn } from "@/lib/utils";
import { getAutomation } from "@/server/automations/service";
import { getUserPlan } from "@/server/billing/plan-of";
import { getAutomationEvents, getAutomationStats } from "@/server/dashboard";
import { getDb } from "@/server/db/client";
import { igAccounts } from "@/server/db/schema";
import { requireUser } from "@/server/session";

export const metadata = { title: "자동화 상세" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MATCH: Record<string, string> = { contains: "포함", exact: "정확히 일치", any: "" };

export default async function AutomationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = getDb();
  const auto = UUID.test(id) ? await getAutomation(db, user.id, id) : null;
  if (!auto) notFound();
  const [[acct], stats, events, plan] = await Promise.all([
    db.select({ username: igAccounts.username, status: igAccounts.status }).from(igAccounts).where(eq(igAccounts.id, auto.igAccountId)),
    getAutomationStats(db, auto.id),
    getAutomationEvents(db, user.id, auto.id),
    getUserPlan(db, user.id),
  ]);
  const ctr = stats.linksSent > 0 ? Math.round((stats.linksClicked / stats.linksSent) * 100) : 0;
  const created = auto.createdAt.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" });
  // 반응한 댓글 = 보냄 + 대기 + 실패 + 건너뜀
  const cells: [string, string, boolean][] = [
    ["반응한 댓글", stats.total.toLocaleString(), true],
    ["보냄", (stats.succeeded + stats.partial).toLocaleString(), false],
    ["대기", stats.pending.toLocaleString(), false],
    ["실패", stats.failed.toLocaleString(), false],
    ["건너뜀", stats.skipped.toLocaleString(), false],
    ["클릭률", plan.linkTracking ? `${ctr}%` : "Pro", false],
  ];

  return (
    <main className="flex flex-col gap-5 px-5 pb-28 pt-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="truncate font-display text-[26px] font-extrabold tracking-[-0.03em]">{auto.name}</h1>
          <span className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            {acct && <AutomationStatusBadge isActive={auto.isActive} mediaScope={auto.mediaScope} accountStatus={acct.status} />}@{acct?.username} ·{" "}
            {created} 만듦
          </span>
        </div>
        <AutomationToggle id={auto.id} active={auto.isActive} label={auto.name} />
      </div>

      <section aria-labelledby="stats-title" className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <h2 id="stats-title" className="text-base font-bold">
            통계
          </h2>
          <span className="text-xs text-muted-foreground">{created}부터 지금까지</span>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {cells.map(([k, v, dark]) => (
            <div key={k} className={cn("rounded-[14px] py-3.5", dark ? "bg-primary text-primary-foreground" : "border bg-card")}>
              <dt className={cn("text-xs", dark ? "text-primary-foreground/75" : "text-muted-foreground")}>{k}</dt>
              <dd className="mt-1 font-display text-[22px] font-extrabold">{v}</dd>
            </div>
          ))}
        </dl>
        <ul className="flex flex-col gap-1 text-xs leading-relaxed text-muted-foreground">
          <li>반응한 댓글은 보냄 · 대기 · 실패 · 건너뜀을 모두 더한 수예요.</li>
          {stats.partial > 0 && <li>보냄에는 DM만 가고 공개 답글은 실패한 ‘일부 발송’ {stats.partial.toLocaleString()}건이 들어 있어요.</li>}
          {plan.linkTracking && (
            <li>
              클릭률은 DM 링크를 받은 사람 중 한 번 이상 누른 사람의 비율이에요. 링크는 모두 {stats.clicks.toLocaleString()}번 눌렸어요.
            </li>
          )}
        </ul>
      </section>

      <section className="flex flex-col gap-3.5 rounded-2xl border bg-card p-[18px]">
        <h2 className="text-base font-bold">설정</h2>
        <div className="flex items-center gap-3">
          <MediaThumb url={auto.mediaThumbnailUrl} scope={auto.mediaScope} className="size-14" />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-semibold">{SCOPE_LABEL[auto.mediaScope]}</span>
            {auto.mediaPermalink && (
              <a href={auto.mediaPermalink} target="_blank" rel="noreferrer" className="text-[13px] underline">
                인스타그램에서 게시물 보기
              </a>
            )}
          </div>
        </div>
        <dl className="flex flex-col gap-3 text-sm">
          <div className="flex gap-3">
            <dt className="w-16 shrink-0 text-muted-foreground">반응</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              {auto.matchType === "any" ? (
                <span className="rounded-md bg-neutral-soft px-2 py-0.5 text-xs font-semibold text-ink-2">모든 댓글</span>
              ) : (
                <>
                  {auto.keywords.map((k) => (
                    <span key={k} className="rounded-md bg-chip px-2 py-0.5 text-xs font-semibold text-chip-foreground">
                      {k}
                    </span>
                  ))}
                  <span className="text-[13px] text-muted-foreground">{MATCH[auto.matchType]}</span>
                </>
              )}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-16 shrink-0 text-muted-foreground">공개 답글</dt>
            <dd>{auto.replyEnabled ? `문구 ${auto.replyTexts.length}개${auto.replyTexts.length > 1 ? " 중 무작위" : ""}` : "보내지 않음"}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-16 shrink-0 text-muted-foreground">DM</dt>
            <dd className="whitespace-pre-wrap leading-relaxed">{auto.dmText}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-16 shrink-0 text-muted-foreground">팔로우</dt>
            <dd className="leading-relaxed">{auto.followGate ? "팔로워에게만 링크 보내기 · 먼저 ‘팔로우했어요’ 안내" : "확인 안 함"}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-16 shrink-0 text-muted-foreground">링크</dt>
            <dd className="min-w-0 break-all leading-relaxed">
              {auto.dmButtonTitle} → {auto.dmLinkUrl.replace(/^https:\/\//, "")}
            </dd>
          </div>
        </dl>
      </section>

      <div className="flex gap-2">
        <Link
          href={`/app/automations/${auto.id}/edit`}
          className="flex h-12 flex-1 items-center justify-center rounded-xl border-[1.5px] border-foreground text-[15px] font-semibold"
        >
          수정
        </Link>
        <DeleteAutomationButton id={auto.id} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">발송 기록</h2>
        <EventList events={events} showAutomation={false} />
      </section>
    </main>
  );
}
