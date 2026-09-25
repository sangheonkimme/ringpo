import { Gauge } from "lucide-react";
import Link from "next/link";
import { nextMonthStartKst } from "@/lib/time";

/** 이번 달 DM 한도를 다 쓴 뒤에는 새 댓글이 건너뜀 처리되므로, 원인과 다음 행동을 알린다 */
export function QuotaBanner({ usage, limit, now }: { usage: number; limit: number; now: Date }) {
  if (usage < limit) return null;
  return (
    <div role="alert" className="flex gap-3 rounded-2xl bg-warning-soft p-4 text-sm text-warning-ink">
      <Gauge className="mt-0.5 size-[18px] shrink-0" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="font-semibold">이번 달 DM {limit.toLocaleString()}건을 모두 썼어요</p>
        <p className="leading-relaxed">
          지금 들어오는 댓글에는 답글과 DM을 보내지 않고 건너뛰어요. {nextMonthStartKst(now)}에 다시 보내기 시작해요.{" "}
          <Link href="/app/billing" className="font-semibold underline">
            플랜 올리기
          </Link>
        </p>
      </div>
    </div>
  );
}
