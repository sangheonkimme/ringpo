import { Plus } from "lucide-react";
import Link from "next/link";

/** 자동화가 하나도 없을 때: 무엇을 하는 기능인지와 첫 행동 하나만 보여 준다 */
export function EmptyAutomations() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card px-6 py-8 text-center">
      <p className="text-base font-bold">아직 자동화가 없어요</p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        댓글에 키워드가 달리면 공개 답글과 DM을
        <br />
        자동으로 보내는 자동화를 만들어 보세요.
      </p>
      <Link href="/app/automations/new" className="mt-1 flex h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
        <Plus className="size-4" strokeWidth={2.4} aria-hidden />첫 자동화 만들기
      </Link>
    </div>
  );
}
