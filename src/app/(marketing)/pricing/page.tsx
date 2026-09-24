import Link from "next/link";
import { PricingCards } from "@/components/marketing/pricing-cards";

export const metadata = { title: "요금" };

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-7xl px-5 py-14 md:px-20 md:py-24">
      <div className="flex flex-col items-center gap-3.5 text-center">
        <h1 className="font-display text-[32px] font-extrabold tracking-[-0.03em] md:text-5xl">필요한 만큼만 쓰세요</h1>
        <p className="text-[15px] leading-relaxed text-ink-2 md:text-[17px]">
          모든 플랜은 월 단위 자동 결제이며 언제든 해지할 수 있어요. 금액은 VAT 포함이에요.
        </p>
      </div>
      <div className="mt-10 md:mt-12">
        <PricingCards />
      </div>
      <ul className="mx-auto mt-10 flex max-w-2xl flex-col gap-2 text-sm leading-relaxed text-muted-foreground">
        <li>· 월 DM 건수는 매월 1일(한국 시간)에 초기화돼요. 한도를 넘으면 다음 달까지 DM 발송이 멈춰요.</li>
        <li>· 상위 플랜으로 변경하면 즉시 새 플랜 요금이 결제되고 새 결제 주기가 시작돼요. 이전 플랜의 남은 기간은 환불되지 않아요.</li>
        <li>· 하위 플랜으로 변경하거나 해지하면 현재 결제 기간이 끝날 때 적용돼요.</li>
        <li>
          · 자세한 내용은{" "}
          <Link href="/refund" className="underline">
            환불정책
          </Link>
          을 확인해주세요.
        </li>
      </ul>
    </div>
  );
}
