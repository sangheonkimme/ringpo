import { and, asc, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { DeleteAccountButton, DisconnectButton } from "@/components/app/settings-actions";
import { ToneBadge } from "@/components/app/status-badge";
import { getUserPlan } from "@/server/billing/plan-of";
import { getDb } from "@/server/db/client";
import { account, igAccounts, campaigns, reportShares } from "@/server/db/schema";
import { requireUser } from "@/server/session";

export const metadata = { title: "설정" };

const PROVIDER: Record<string, string> = { kakao: "카카오 로그인", google: "Google 로그인" };

export default async function SettingsPage() {
  const user = await requireUser();
  const db = getDb();
  const accounts = await db
    .select()
    .from(igAccounts)
    .where(and(eq(igAccounts.userId, user.id), ne(igAccounts.status, "disconnected")))
    .orderBy(asc(igAccounts.createdAt));
  const [login] = await db.select({ providerId: account.providerId }).from(account).where(eq(account.userId, user.id)).limit(1);
  const plan = await getUserPlan(db, user.id);
  const [hasShare] = await db.select({ id: reportShares.id }).from(reportShares).innerJoin(campaigns, eq(campaigns.id, reportShares.campaignId)).where(eq(campaigns.userId, user.id)).limit(1);

  return (
    <main className="flex flex-col gap-5 px-5 pb-28 pt-5">
      <h1 className="font-display text-[28px] font-extrabold leading-[1.3] tracking-[-0.03em]">설정</h1>

      {hasShare && <Link href="/app/report-shares" className="rounded-xl border bg-card p-4 font-semibold">공유 리포트 관리</Link>}

      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-bold">인스타그램 계정</h2>
          <span className="text-[13px] text-muted-foreground">
            {accounts.length} / {plan.maxIgAccounts}
          </span>
        </div>
        {accounts.map((a) => (
          // 버튼이 둘(다시 연결 + 연결 해제)일 때 좁은 화면에서 이름·배지가 눌려 세로로 깨졌다 — 버튼 줄을 아래로 내린다
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-[180px] flex-1 items-center gap-2.5">
              {a.profilePictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.profilePictureUrl} alt="" className="size-10 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="size-10 shrink-0 rounded-full bg-accent" />
              )}
              <div className="flex min-w-0 flex-col gap-[3px]">
                <span className="truncate text-[15px] font-bold">@{a.username}</span>
                {a.status === "active" ? (
                  <ToneBadge tone="success" className="self-start">
                    연결됨
                  </ToneBadge>
                ) : (
                  <ToneBadge tone="danger" className="self-start">
                    다시 연결 필요
                  </ToneBadge>
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              {a.status !== "active" && (
                <a href="/api/instagram/connect" className="flex h-11 items-center rounded-2xl bg-primary px-5 text-[15px] font-bold text-primary-foreground">
                  다시 연결
                </a>
              )}
              <DisconnectButton accountId={a.id} username={a.username} />
            </div>
          </div>
        ))}
        {accounts.length < plan.maxIgAccounts ? (
          <a href="/api/instagram/connect" className="flex h-12 items-center justify-center rounded-2xl border-2 border-foreground text-[15px] font-bold">
            인스타그램 계정 연결
          </a>
        ) : (
          plan.id !== "agency" && (
            <p className="text-[13px] leading-normal text-muted-foreground">
              지금은 인스타 계정을 1개만 연결할 수 있어요. 여러 계정용 요금제는 준비 중이에요.
            </p>
          )
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
        <h2 className="text-base font-bold">내 계정</h2>
        <p className="text-sm text-ink-2">
          {user.email}
          {login && PROVIDER[login.providerId] ? ` · ${PROVIDER[login.providerId]}` : ""}
        </p>
        <nav aria-label="약관" className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          <Link href="/terms" className="flex h-8 items-center underline">
            이용약관
          </Link>
          <Link href="/privacy" className="flex h-8 items-center font-bold underline">
            개인정보처리방침
          </Link>
          <Link href="/refund" className="flex h-8 items-center underline">
            환불정책
          </Link>
        </nav>
        <div className="h-px bg-line-soft" />
        <DeleteAccountButton />
      </section>
    </main>
  );
}
