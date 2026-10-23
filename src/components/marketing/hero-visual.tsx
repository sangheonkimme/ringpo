import { DmBubble } from "@/components/app/message-preview";

/** 랜딩 첫 화면 그림(디자인 A): 핑크 블록 위에 게시물 댓글 카드와 자동 DM 카드, 기울어진 노랑 스티커 */
export function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[420px] md:max-w-[560px] md:justify-self-end">
      <div className="flex flex-col gap-4 rounded-[36px] bg-pop px-5 pb-14 pt-7 md:gap-5 md:rounded-[44px] md:px-8 md:pb-16 md:pt-10">
        <div className="flex flex-col gap-3 rounded-3xl bg-card p-4 shadow-[0_6px_0_var(--foreground)] md:gap-4 md:p-5">
          <div className="flex h-32 items-end rounded-2xl bg-lilac p-3 md:h-44">
            <span className="rounded-full bg-card px-3 py-1.5 text-xs font-bold md:text-[13px]">릴스 · 10월 텀블러 공구</span>
          </div>
          <p className="hidden text-sm leading-[1.7] text-ink-2 md:block">
            <strong className="text-foreground">hana.living</strong> 오늘 밤 9시 공구 오픈! 댓글에 ‘공구’ 남겨주시면 링크 보내드려요
          </p>
          <div className="flex items-start gap-2.5">
            <span className="size-7 shrink-0 rounded-full border-2 border-foreground bg-brand md:size-8" />
            <p className="text-[13px] md:text-sm">
              <strong>jiwoo.daily</strong> <mark className="rounded bg-brand px-1 text-inherit">공구</mark> 링크 주세요!
            </p>
          </div>
          <div className="flex items-start gap-2.5 pl-9 md:pl-[42px]">
            <span className="size-6 shrink-0 rounded-full bg-foreground md:size-7" />
            <div className="flex flex-col gap-1.5">
              <p className="text-[13px] md:text-sm">
                <strong>hana.living</strong> @jiwoo.daily DM 확인해주세요!
              </p>
              <span className="self-start rounded-md bg-pop-soft px-2 py-0.5 text-[11px] font-bold text-pop-ink">자동 답글</span>
            </div>
          </div>
        </div>

        <div className="ml-auto flex w-[88%] flex-col gap-3 rounded-3xl bg-card p-4 shadow-[0_6px_0_var(--foreground)] md:gap-3.5 md:p-5">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold md:text-sm">hana.living · 메시지</span>
            <span className="rounded-full bg-brand px-2.5 py-1 text-[11px] font-bold md:text-xs">자동 DM</span>
          </div>
          <DmBubble text="요청하신 텀블러 공구 링크예요. 10월 31일까지 공구가로 만나보세요." buttonTitle="구매하러 가기" />
        </div>
      </div>

      <span className="absolute -bottom-4 -left-2 -rotate-[5deg] rounded-full border-2 border-foreground bg-brand px-4 py-2.5 text-sm font-black md:-left-4 md:px-5 md:py-3 md:text-[15px]">
        몇 초 안에 자동 발송
      </span>
    </div>
  );
}
