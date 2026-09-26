import { ArrowRight, Clock, Link2 } from "lucide-react";

export function HeroVisual() {
  return (
    <div className="relative mx-auto h-[520px] w-full max-w-[350px] md:h-[640px] md:max-w-[600px] md:justify-self-end">
      <div className="absolute left-0 top-0 w-[290px] overflow-hidden rounded-[20px] border bg-card shadow-[0_28px_56px_-28px_rgba(22,18,14,0.35)] md:w-[392px] md:rounded-3xl">
        <div className="flex h-40 items-end bg-[#E6EBF0] p-3 md:h-[232px] md:p-4">
          <span className="rounded-full bg-white/90 px-2.5 py-1.5 text-xs font-semibold md:text-[13px]">릴스 · 10월 텀블러 공구</span>
        </div>
        <div className="flex flex-col gap-3 px-4 pb-[18px] pt-3.5 md:gap-4 md:px-5 md:pb-[22px] md:pt-[18px]">
          <p className="hidden text-sm leading-relaxed text-ink-2 md:block">
            <strong className="text-foreground">hana.living</strong> 오늘 밤 9시 공구 오픈! 댓글에 ‘공구’ 남겨주시면 링크 보내드려요
          </p>
          <div className="hidden h-px bg-line-soft md:block" />
          <div className="flex items-start gap-2.5">
            <span className="size-7 shrink-0 rounded-full bg-[#D3DBE5] md:size-8" />
            <div className="flex flex-col gap-1">
              <p className="text-[13px] md:text-sm">
                <strong>jiwoo.daily</strong> <mark className="bg-transparent bg-[linear-gradient(transparent_55%,var(--color-brand)_55%)] text-inherit">공구</mark> 링크 주세요!
              </p>
              <span className="hidden text-xs text-muted-foreground md:block">방금</span>
            </div>
          </div>
          <div className="flex items-start gap-2.5 pl-9 md:pl-[42px]">
            <span className="size-6 shrink-0 rounded-full bg-foreground md:size-7" />
            <div className="flex flex-col gap-1.5">
              <p className="text-[13px] md:text-sm">
                <strong>hana.living</strong> @jiwoo.daily DM 확인해주세요!
              </p>
              <span className="self-start rounded-md bg-background px-2 py-0.5 text-[11px] font-semibold text-ink-2">자동 답글</span>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute left-6 top-[540px] hidden items-center gap-2 rounded-full bg-foreground px-4 py-3 text-sm font-semibold text-white md:flex">
        <Clock className="size-4" aria-hidden />
        몇 초 안에 자동 발송
        <ArrowRight className="size-4" aria-hidden />
      </div>

      <div className="absolute bottom-0 right-0 flex w-[270px] flex-col gap-3 rounded-[20px] border bg-card p-4 shadow-[0_28px_56px_-24px_rgba(22,18,14,0.38)] md:w-[340px] md:gap-3.5 md:rounded-3xl md:p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="size-7 rounded-full bg-foreground md:size-8" />
            <div className="flex flex-col">
              <span className="text-[13px] font-semibold md:text-sm">hana.living</span>
              <span className="hidden text-xs text-muted-foreground md:block">메시지</span>
            </div>
          </div>
          <span className="rounded-full bg-brand px-2.5 py-1 text-[11px] font-bold md:text-xs">자동 DM</span>
        </div>
        <p className="rounded-[16px_16px_16px_6px] bg-bubble px-3.5 py-3 text-sm leading-relaxed md:rounded-[18px_18px_18px_6px] md:px-4 md:py-3.5 md:text-[15px]">
          요청하신 텀블러 공구 링크예요. 10월 31일까지 공구가로 만나보세요.
        </p>
        <span className="flex h-11 items-center justify-center gap-2 rounded-xl bg-foreground text-sm font-semibold text-white md:h-12 md:text-[15px]">
          <Link2 className="size-[18px]" aria-hidden />
          구매하러 가기
        </span>
      </div>
    </div>
  );
}
