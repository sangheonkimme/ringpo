import { desc, eq } from "drizzle-orm";
import { BillingClient } from "@/components/app/billing-client";
import { ToneBadge } from "@/components/app/status-badge";
import type { StatusTone } from "@/lib/automation-status";
import { formatKrw, PLANS } from "@/lib/plans";
import { kstDate } from "@/lib/time";
import { billingConfigured } from "@/server/billing/gateway";
import { getDb } from "@/server/db/client";
import { payments, subscriptions } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { requireUser } from "@/server/session";
import { getDmUsage } from "@/server/usage";

export const metadata = { title: "결제" };

const PAYMENT_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: "확인 중", tone: "neutral" },
  paid: { label: "결제 완료", tone: "success" },
  failed: { label: "실패", tone: "danger" },
  canceled: { label: "취소", tone: "neutral" },
};

export default async function BillingPage() {
  const user = await requireUser();
  const db = getDb();
  const env = getEnv();
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id));
  const history = await db.select().from(payments).where(eq(payments.userId, user.id)).orderBy(desc(payments.createdAt)).limit(24);
  const usage = await getDmUsage(db, user.id, new Date());
  const planId = sub && sub.status !== "canceled" ? sub.plan : "free";
  const plan = PLANS[planId];
  const paidActive = planId !== "free";

  return (
    <main className="flex flex-col gap-5 px-5 pb-28 pt-5">
      <h1 className="font-display text-[28px] font-extrabold leading-[1.3] tracking-[-0.03em]">결제</h1>

      <section className="flex flex-col gap-3.5 rounded-2xl bg-foreground p-5 text-background">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-input">현재 플랜</span>
            <span className="font-display text-[30px] font-extrabold">{plan.name}</span>
          </div>
          <span className="text-[15px] font-semibold">{paidActive ? `${formatKrw(plan.priceKrw)} / 월` : "무료"}</span>
        </div>
        <dl className="flex flex-col gap-2 text-sm">
          {paidActive && sub?.currentPeriodEnd && (
            <div className="flex justify-between gap-3">
              <dt className="text-input">{sub.cancelAtPeriodEnd ? "이용 종료일" : "다음 결제일"}</dt>
              <dd>
                {kstDate(sub.currentPeriodEnd)}
                {sub.pendingPlan && ` · 다음부터 ${PLANS[sub.pendingPlan].name}`}
              </dd>
            </div>
          )}
          {sub?.cardLabel && paidActive && (
            <div className="flex justify-between gap-3">
              <dt className="text-input">결제 카드</dt>
              <dd>{sub.cardLabel}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-input">이번 달 DM</dt>
            <dd>
              {usage.toLocaleString()} / {plan.monthlyDmLimit.toLocaleString()}
            </dd>
          </div>
        </dl>
        {sub?.status === "past_due" && (
          <p className="rounded-xl bg-danger-soft px-3.5 py-3 text-[13px] leading-normal text-danger-ink">
            결제에 실패했어요. {sub.nextRetryAt ? `${kstDate(sub.nextRetryAt)}에 다시 시도해요.` : ""} 카드를 변경해주세요.
          </p>
        )}
      </section>

      {billingConfigured() && env.PORTONE_STORE_ID && env.PORTONE_CHANNEL_KEY ? (
        <BillingClient
          storeId={env.PORTONE_STORE_ID}
          channelKey={env.PORTONE_CHANNEL_KEY}
          appUrl={env.APP_URL}
          user={{ id: user.id, email: user.email }}
          current={{
            plan: planId,
            paidActive,
            cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
            pendingPlan: sub?.pendingPlan ?? null,
            customerName: sub?.customerName ?? null,
            customerPhone: sub?.customerPhone ?? null,
          }}
        />
      ) : (
        <p className="rounded-2xl border border-dashed border-input p-6 text-center text-sm text-ink-2">
          결제 기능을 준비하고 있어요. 곧 유료 플랜을 이용할 수 있어요.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">결제 내역</h2>
        {history.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-input p-6 text-center text-sm text-ink-2">결제 내역이 없어요</p>
        ) : (
          <ul className="overflow-hidden rounded-2xl border bg-card text-sm">
            {history.map((p) => {
              const st = PAYMENT_STATUS[p.status];
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3.5 last:border-b-0">
                  <span>
                    {p.createdAt.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} · {PLANS[p.plan].name}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {formatKrw(p.amount)}
                    <ToneBadge tone={st.tone}>{st.label}</ToneBadge>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
