import { Check, Minus } from "lucide-react";
import Link from "next/link";
import { formatKrw, PLANS, type PlanId } from "@/lib/plans";
import { cn } from "@/lib/utils";

const CARDS: { id: PlanId; tagline: string; features: string[]; minus?: string; cta: string; href: string }[] = [
  {
    id: "free",
    tagline: "처음 써보는 크리에이터",
    features: ["인스타 계정 1개", "자동화 3개", "월 DM 1,000건", "공개 답글 + DM 자동 발송"],
    minus: "DM 하단에 서비스 표시",
    cta: "무료로 시작",
    href: "/login",
  },
  {
    id: "pro",
    tagline: "공구를 정기적으로 여는 크리에이터",
    features: ["인스타 계정 1개", "자동화 무제한", "월 DM 10,000건", "링크 클릭 추적", "서비스 표시 제거"],
    cta: "Pro 시작하기",
    href: "/app/billing",
  },
];

export function PricingCards() {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-5 md:grid-cols-2 md:gap-6">
      {CARDS.map((c) => {
        const plan = PLANS[c.id];
        const featured = c.id === "pro";
        return (
          <div
            key={c.id}
            className={cn(
              "flex flex-col gap-6 rounded-[20px] p-6 md:rounded-3xl md:p-8",
              featured ? "order-first bg-foreground text-background md:order-none" : "border bg-card",
            )}
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold md:text-[22px]">{plan.name}</h3>
                {featured && <span className="rounded-full bg-brand px-3 py-1 text-xs font-bold text-foreground">추천</span>}
              </div>
              <p className={cn("text-[15px]", featured ? "text-[#D3DBE5]" : "text-muted-foreground")}>{c.tagline}</p>
            </div>
            <p className="flex items-baseline gap-1.5">
              <span className="font-display text-[34px] font-extrabold tracking-[-0.03em] md:text-[44px]">
                {plan.priceKrw === 0 ? "0원" : formatKrw(plan.priceKrw)}
              </span>
              {plan.priceKrw > 0 && <span className={cn("text-[15px]", featured ? "text-[#D3DBE5]" : "text-muted-foreground")}>/ 월</span>}
            </p>
            <ul className="flex flex-1 flex-col gap-3 text-[15px]">
              {c.features.map((f) => (
                <li key={f} className="flex items-center gap-2.5">
                  <Check className={cn("size-[18px]", featured && "text-brand")} strokeWidth={2.4} aria-hidden />
                  {f}
                </li>
              ))}
              {c.minus && (
                <li className="flex items-center gap-2.5 text-muted-foreground">
                  <Minus className="size-[18px]" strokeWidth={2.4} aria-hidden />
                  {c.minus}
                </li>
              )}
            </ul>
            <Link
              href={c.href}
              className={cn(
                "flex h-[54px] items-center justify-center rounded-[14px] text-base font-semibold",
                featured ? "bg-brand font-bold text-foreground" : "border-[1.5px] border-foreground",
              )}
            >
              {c.cta}
            </Link>
          </div>
        );
      })}
    </div>
  );
}
