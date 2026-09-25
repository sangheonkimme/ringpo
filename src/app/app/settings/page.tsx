import { and, asc, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { DeleteAccountButton, DisconnectButton } from "@/components/app/settings-actions";
import { getUserPlan } from "@/server/billing/plan-of";
import { getDb } from "@/server/db/client";
import { account, igAccounts } from "@/server/db/schema";
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

  return (
    <main className="flex flex-col gap-4 px-5 pb-28 pt-5">
      <h1 className="font-display text-[28px] font-extrabold tracking-[-0.03em]">설정</h1>

      <section className="flex flex-col gap-3.5 rounded-[18px] border bg-card p-[18px]">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-bold">인스타그램 계정</h2>
          <span className="text-[13px] text-muted-foreground">
            {accounts.length} / {plan.maxIgAccounts}
          </span>
        </div>
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {a.profilePictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.profilePictureUrl} alt="" className="size-10 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="size-10 shrink-0 rounded-full bg-[#E6EBF0]" />
              )}
              <div className="flex min-w-0 flex-col gap-[3px]">
                <span className="truncate text-[15px] font-bold">@{a.username}</span>
                {a.status === "active" ? (
                  <span className="self-start rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success-ink">연결됨</span>
                ) : (
                  <span className="self-start rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger-ink">다시 연결 필요</span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              {a.status !== "active" && (
                <a href="/api/instagram/connect" className="flex h-11 items-center rounded-[10px] bg-foreground px-3.5 text-sm font-semibold text-white">
                  다시 연결
                </a>
              )}
              <DisconnectButton accountId={a.id} username={a.username} />
            </div>
          </div>
        ))}
        {accounts.length < plan.maxIgAccounts ? (
          <a href="/api/instagram/connect" className="flex h-12 items-center justify-center rounded-xl border-[1.5px] border-foreground text-[15px] font-semibold">
            인스타그램 계정 연결
          </a>
        ) : (
          plan.id !== "agency" && (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              지금은 인스타 계정을 1개만 연결할 수 있어요. 여러 계정용 요금제는 준비 중이에요.
            </p>
          )
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-[18px] border bg-card p-[18px]">
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
