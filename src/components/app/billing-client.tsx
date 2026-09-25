"use client";

import * as PortOne from "@portone/browser-sdk/v2";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { cancelSubscriptionAction, resumeSubscriptionAction, scheduleDowngradeAction } from "@/app/app/billing/actions";
import { formatKrw, isUpgrade, PLANS, type PaidPlanId, type PlanId } from "@/lib/plans";
import { cn } from "@/lib/utils";

export interface BillingClientProps {
  storeId: string;
  channelKey: string;
  appUrl: string;
  user: { id: string; email: string };
  current: {
    plan: PlanId;
    paidActive: boolean;
    cancelAtPeriodEnd: boolean;
    pendingPlan: PlanId | null;
    customerName: string | null;
    customerPhone: string | null;
  };
}

const SUMMARY: Record<PaidPlanId, string> = {
  pro: "계정 1개 · 자동화 무제한 · 월 DM 10,000건 · 링크 클릭 추적",
  agency: "계정 5개 · 자동화 무제한 · 월 DM 50,000건 · 링크 클릭 추적",
};

/** 포트원 issueId: ASCII만 허용(KG이니시스) */
function newIssueId(): string {
  return `issue_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const field = "h-[50px] w-full rounded-xl border border-input bg-card px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function BillingClient({ storeId, channelKey, appUrl, user, current }: BillingClientProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<PaidPlanId | null>(null);
  const [name, setName] = useState(current.customerName ?? "");
  const [phone, setPhone] = useState(current.customerPhone ?? "");
  const [pending, startTransition] = useTransition();

  async function registerAndPay(plan: PaidPlanId) {
    const cleanPhone = phone.replace(/\D/g, "");
    if (!name.trim()) return void toast.error("결제자 이름을 입력해주세요");
    if (!/^0\d{8,10}$/.test(cleanPhone)) return void toast.error("휴대폰 번호를 확인해주세요");
    const res = await PortOne.requestIssueBillingKey({
      storeId,
      channelKey,
      billingKeyMethod: "CARD",
      issueId: newIssueId(),
      issueName: `${PLANS[plan].name} 월 정기결제`,
      customer: { customerId: user.id, fullName: name.trim(), phoneNumber: cleanPhone, email: user.email },
      offerPeriod: { interval: "1m" },
      redirectUrl: `${appUrl}/app/billing/complete?plan=${plan}`,
    });
    if (!res || res.code !== undefined || !res.billingKey) {
      toast.error(res?.message ?? "카드 등록이 취소됐어요");
      return;
    }
    const apiRes = await fetch("/api/billing/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan, billingKey: res.billingKey, customerName: name.trim(), customerPhone: cleanPhone }),
    });
    const body = (await apiRes.json()) as { ok: boolean; charged?: boolean; error?: string };
    if (!body.ok) return void toast.error(body.error ?? "결제에 실패했어요");
    toast.success(body.charged ? `${PLANS[plan].name} 플랜이 시작됐어요` : "카드를 변경했어요");
    setSelected(null);
    router.refresh();
  }

  const act = (fn: () => Promise<boolean>, success: string) =>
    startTransition(async () => {
      if (await fn()) toast.success(success);
      else toast.error("처리하지 못했어요");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      {(["pro", "agency"] as const).map((id) => {
        const plan = PLANS[id];
        const isCurrent = current.paidActive && current.plan === id;
        const upgrade = !current.paidActive || isUpgrade(current.plan, id);
        const open = selected === id;
        return (
          <section key={id} className={cn("flex flex-col gap-3 rounded-[18px] bg-card p-[18px]", isCurrent ? "border-2 border-foreground" : "border")}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{plan.name}</h2>
              <span className="text-[15px] font-semibold">{formatKrw(plan.priceKrw)} / 월</span>
            </div>
            <p className="text-[13px] leading-relaxed text-muted-foreground">{SUMMARY[id]}</p>
            {open && (
              <div className="flex flex-col gap-3.5">
                <div className="flex flex-col gap-2">
                  <label htmlFor={`name-${id}`} className="text-sm font-semibold">
                    결제자 이름
                  </label>
                  <input id={`name-${id}`} value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} className={field} />
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor={`phone-${id}`} className="text-sm font-semibold">
                    휴대폰 번호
                  </label>
                  <input
                    id={`phone-${id}`}
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    placeholder="01012345678"
                    autoComplete="tel"
                    onChange={(e) => setPhone(e.target.value)}
                    className={field}
                  />
                </div>
                <p className="rounded-xl bg-background px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">
                  {isCurrent
                    ? "새 카드를 등록하면 다음 결제부터 새 카드로 청구돼요."
                    : current.paidActive
                      ? `등록 즉시 ${formatKrw(plan.priceKrw)}이 결제되고 오늘부터 새 결제 주기가 시작돼요. ${PLANS[current.plan].name}의 남은 기간은 환불되지 않아요.`
                      : `등록 즉시 ${formatKrw(plan.priceKrw)}이 결제되고, 매월 같은 날 자동 결제돼요. 언제든 해지할 수 있어요.`}
                </p>
              </div>
            )}
            <div className="flex gap-2">
              {open ? (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setSelected(null)}
                    className="h-[52px] rounded-xl border-[1.5px] border-foreground px-[18px] text-[15px] font-semibold disabled:opacity-60"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => startTransition(() => registerAndPay(id))}
                    className="h-[52px] flex-1 rounded-xl bg-foreground text-[15px] font-semibold text-white disabled:opacity-60"
                  >
                    {isCurrent ? "새 카드 등록" : `${formatKrw(plan.priceKrw)} 결제하고 ${current.paidActive ? `${plan.name}로 변경` : `${plan.name} 시작`}`}
                  </button>
                </>
              ) : isCurrent ? (
                <button type="button" onClick={() => setSelected(id)} className="h-12 flex-1 rounded-xl border-[1.5px] border-foreground text-[15px] font-semibold">
                  현재 플랜 · 카드 변경
                </button>
              ) : upgrade ? (
                <button type="button" onClick={() => setSelected(id)} className="h-12 flex-1 rounded-xl bg-foreground text-[15px] font-semibold text-white">
                  {current.paidActive ? "업그레이드" : "시작하기"}
                </button>
              ) : current.pendingPlan === id ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => scheduleDowngradeAction(null), "변경 예약을 취소했어요")}
                  className="h-12 flex-1 rounded-xl border-[1.5px] border-foreground text-[15px] font-semibold"
                >
                  다음 결제일부터 변경 예정 · 취소
                </button>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => scheduleDowngradeAction("pro"), "다음 결제일부터 Pro로 변경돼요")}
                  className="h-12 flex-1 rounded-xl border-[1.5px] border-foreground text-[15px] font-semibold"
                >
                  다음 결제일부터 변경
                </button>
              )}
            </div>
          </section>
        );
      })}

      {current.paidActive && (
        <div className="text-center">
          {current.cancelAtPeriodEnd ? (
            <button type="button" disabled={pending} onClick={() => act(resumeSubscriptionAction, "해지를 취소했어요")} className="h-11 px-3 text-sm font-semibold underline">
              해지 취소하고 계속 이용하기
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => act(cancelSubscriptionAction, "현재 결제 기간이 끝나면 해지돼요")}
              className="h-11 px-3 text-sm text-muted-foreground underline"
            >
              구독 해지
            </button>
          )}
        </div>
      )}
    </div>
  );
}
