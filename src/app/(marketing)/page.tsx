import { ArrowRight, Clock, Link2, Lock, MessageCircle, Plus, ShieldCheck, Shuffle } from "lucide-react";
import Link from "next/link";
import { HeroVisual } from "@/components/marketing/hero-visual";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

/*
 * 디자인 A "블록 팝" (2026-10-23). 색 블록 카드 · 굵은 잉크 테두리 · 아래로 떨어지는 그림자 · Black Han Sans 제목.
 * 페르소나 카드는 핑크 / 노랑 / 연보라 순서로 한 장씩 색을 바꾼다.
 */
const personas = [
  {
    who: "공구 크리에이터",
    title: ["공구 오픈 날", "쏟아지는 댓글 1,000개"],
    body: "댓글 단 사람 모두에게 구매 링크 DM이 바로 나가요. 답장이 늦어 놓치던 구매를 붙잡아요.",
    trigger: "공구",
    dm: "DM 구매 링크",
    tone: "bg-pop text-white",
    // 핑크 면 위 작은 글자는 흰색이어야 4.5:1 이 나온다(연분홍은 4.1:1)
    whoTone: "text-white",
    bodyTone: "text-white",
    dmTone: "bg-brand text-foreground",
  },
  {
    who: "정보형 크리에이터",
    title: ["“댓글 남기면", "PDF 드려요” 릴스"],
    body: "자료 링크를 DM으로 자동 배포해요. 한 명 한 명 보내던 수작업이 사라져요.",
    trigger: "자료",
    dm: "DM PDF 링크",
    tone: "bg-brand text-foreground",
    whoTone: "text-yellow-ink",
    bodyTone: "text-foreground",
    dmTone: "bg-foreground text-white",
  },
  {
    who: "막 시작한 크리에이터",
    title: ["도달과 참여를", "키우는 중"],
    body: "댓글에 자동 답글과 DM이 나가 대화가 이어져요. Free 플랜으로 부담 없이 시작해요.",
    trigger: "참여",
    dm: "DM 이벤트 안내",
    tone: "bg-lilac text-foreground",
    whoTone: "text-lilac-ink",
    bodyTone: "text-foreground",
    dmTone: "bg-foreground text-white",
  },
];

const steps = [
  { title: "인스타그램 계정 연결", body: "비즈니스·크리에이터 계정을 인스타그램 공식 로그인으로 연결해요. 비밀번호는 받지 않아요.", tile: "bg-pop text-white" },
  { title: "키워드와 메시지 설정", body: "게시물을 고르고, 반응할 키워드(또는 모든 댓글)와 공개 답글·DM 문구·링크를 적어요.", tile: "bg-brand text-foreground" },
  { title: "댓글이 달리면 자동 발송", body: "몇 초 안에 답글과 링크 버튼 DM이 나가요. 발송·클릭 수는 대시보드에서 확인해요.", tile: "bg-lilac text-foreground" },
];

const features = [
  { icon: MessageCircle, title: "공개 답글 + DM 동시 발송", body: "댓글에는 “DM 확인해주세요” 답글을, 링크는 버튼이 달린 DM으로 보내요." },
  { icon: Shuffle, title: "답글 문구 랜덤 발송", body: "문구 3~5개를 번갈아 보내 같은 문구 반복으로 인한 스팸 판정을 피해요." },
  { icon: ShieldCheck, title: "게시물마다 한 번만", body: "같은 사람이 한 게시물에 댓글을 여러 번 달아도 DM은 한 번만 가요. 내 댓글에는 반응하지 않아요." },
  { icon: Clock, title: "발송 한도 자동 조절", body: "인스타그램의 시간당 발송 한도를 넘는 분량은 대기열에 넣고 순서대로 보내요." },
  { icon: Link2, title: "링크 클릭 추적", body: "DM 링크를 몇 명이 눌렀는지 자동화별로 확인해요.", pro: true },
  { icon: Lock, title: "공식 API만 사용", body: "Meta 공식 Instagram API로만 동작해요. 비밀번호 저장, 팔로우·좋아요 자동화는 하지 않아요." },
];

const faqs = [
  {
    q: "개인 계정도 쓸 수 있나요?",
    a: "인스타그램 정책상 비즈니스 또는 크리에이터 계정만 연결할 수 있어요. 인스타그램 설정에서 무료로 전환할 수 있고, 연결 화면에서 방법을 안내해드려요.",
  },
  {
    q: "계정이 정지될 위험은 없나요?",
    a: `${site.name}는 Meta가 공식 제공하는 Instagram API만 쓰고, 댓글을 남긴 사람에게만, 게시물마다 한 번 보내요. 답글 문구도 번갈아 보내 반복을 피해요.`,
  },
  { q: "인스타 비밀번호를 알려줘야 하나요?", a: "아니요. 인스타그램 공식 로그인 창에서 권한만 허용하면 되고, 비밀번호는 저장하지 않아요." },
  {
    q: "댓글이 한꺼번에 수천 개 달리면요?",
    a: "인스타그램의 시간당 발송 한도를 넘는 분량은 대기열에 넣고 순서대로 보내요. 인스타그램 정책상 댓글 후 7일이 지나면 DM을 보낼 수 없어요.",
  },
  {
    q: "DM은 상대방에게 어떻게 보이나요?",
    a: "댓글 단 사람이 내 계정을 팔로우하면 메시지함으로, 아니면 메시지 요청함으로 들어가요. 링크는 버튼으로 보여요.",
  },
];

const container = "mx-auto max-w-7xl px-5 md:px-12";
const h2 = "font-display text-[32px] leading-[1.22] tracking-[-0.02em] md:text-[54px] md:leading-[1.18]";
/** 작은 꼬리표(섹션 이름) */
const tag = "self-start rounded-full px-3.5 py-1.5 text-sm font-bold";
const cta =
  "flex h-14 items-center justify-center gap-2.5 rounded-2xl px-7 text-base font-bold transition-transform active:translate-y-0.5 md:h-[60px] md:text-[17px]";

export default function LandingPage() {
  return (
    <>
      <section className={`${container} grid items-center gap-14 pb-16 pt-8 md:grid-cols-2 md:gap-14 md:pb-28 md:pt-16`}>
        <div className="flex flex-col gap-5 md:gap-7">
          <span className={cn(tag, "bg-pop-soft text-pop-ink")}>인스타그램 댓글 자동 DM</span>
          <div className="flex flex-col gap-3 md:gap-4">
            <h1 className="font-display text-[48px] leading-[1.1] tracking-[-0.02em] md:text-[88px] md:leading-[1.06]">
              댓글에{" "}
              <mark className="inline-block -rotate-2 rounded-2xl bg-brand px-2.5 text-inherit md:rounded-3xl md:px-3.5">‘링크’</mark>
              <br />
              남겨주세요.
            </h1>
            <p className="text-[22px] font-black tracking-[-0.03em] text-brand-ink md:text-[34px]">DM은 저희가 보낼게요.</p>
          </div>
          <p className="max-w-[540px] text-base leading-[1.7] text-ink-2 md:text-[19px]">
            키워드 댓글이 달리면 공개 답글과 링크 버튼이 담긴 DM을 몇 초 안에 자동으로 보내요. 공구·자료 배포·이벤트 댓글에 하나하나
            답하던 시간을 돌려드려요.
          </p>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <Link href="/login" className={cn(cta, "bg-primary text-primary-foreground shadow-[0_6px_0_var(--foreground)]")}>
              무료로 시작하기
              <ArrowRight className="size-5" aria-hidden />
            </Link>
            <Link href="#pricing" className={cn(cta, "border-2 border-foreground bg-card")}>
              요금 보기
            </Link>
          </div>
          <p className="text-center text-[13px] text-muted-foreground md:text-left md:text-sm">
            카드 등록 없이 시작 · Free 플랜 월 DM 1,000건
          </p>
        </div>
        <HeroVisual />
      </section>

      <section className="bg-foreground text-white">
        <div className={`${container} flex flex-col gap-9 py-16 md:gap-12 md:py-28`}>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-10">
            <h2 className={h2}>
              공구부터 자료 배포까지,
              <br />
              댓글 한 줄이면 돼요
            </h2>
            <p className="max-w-[440px] text-[15px] leading-[1.7] text-sidebar-foreground md:text-[17px]">
              댓글 이벤트는 자주 열지만 전담 인력은 없는 크리에이터를 위해 만들었어요.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3 md:gap-5">
            {personas.map((p) => (
              <article key={p.who} className={cn("flex flex-col gap-4 rounded-3xl p-6 md:rounded-[32px] md:p-8", p.tone)}>
                <p className={cn("text-sm font-bold", p.whoTone)}>{p.who}</p>
                <h3 className="text-[23px] font-black leading-[1.35] tracking-[-0.03em] md:text-[27px]">
                  {p.title[0]}
                  <br />
                  {p.title[1]}
                </h3>
                <p className={cn("text-[15px] leading-[1.7]", p.bodyTone)}>{p.body}</p>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                  <span className="rounded-full bg-card px-3 py-1.5 text-[13px] font-bold text-foreground">댓글 “{p.trigger}”</span>
                  <ArrowRight className="size-[18px]" aria-hidden />
                  <span className={cn("rounded-full px-3 py-1.5 text-[13px] font-bold", p.dmTone)}>{p.dm}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className={`${container} flex flex-col gap-9 py-16 md:gap-12 md:py-28`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-3">
            <span className={cn(tag, "bg-lilac text-lilac-ink")}>사용 방법</span>
            <h2 className={h2}>3분이면 첫 자동화 완성</h2>
          </div>
          <p className="text-[15px] leading-[1.7] text-ink-2 md:max-w-[380px] md:text-[17px]">가입부터 첫 자동 발송까지 필요한 건 인스타그램 계정 하나예요.</p>
        </div>
        <ol className="grid gap-4 md:grid-cols-3 md:gap-5">
          {steps.map((s, i) => (
            <li key={s.title} className="flex flex-col gap-3.5 rounded-3xl border-2 border-foreground bg-card p-6 md:rounded-[32px] md:p-8">
              <span className={cn("flex size-14 items-center justify-center rounded-2xl font-display text-[28px] md:size-16 md:text-[32px]", s.tile)}>{i + 1}</span>
              <h3 className="text-xl font-black tracking-[-0.02em] md:text-[23px]">{s.title}</h3>
              <p className="text-[15px] leading-[1.7] text-ink-2 md:text-base">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-lilac">
        <div className={`${container} flex flex-col gap-9 py-16 md:gap-12 md:py-28`}>
          <h2 className={h2}>댓글 이벤트에 필요한 것만 담았어요</h2>
          <div className="grid gap-3 md:grid-cols-3 md:gap-5">
            {features.map(({ icon: Icon, title, body, pro }) => (
              <div key={title} className="flex gap-4 rounded-3xl bg-card p-5 md:flex-col md:rounded-[28px] md:p-7">
                <div className="flex items-start justify-between">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-pop-soft text-pop-ink md:size-12">
                    <Icon className="size-[22px]" aria-hidden />
                  </span>
                  {pro && <span className="hidden rounded-full bg-brand px-2.5 py-0.5 text-xs font-bold md:inline">Pro</span>}
                </div>
                <div className="flex flex-col gap-1 md:gap-2.5">
                  <h3 className="text-base font-black md:text-[20px]">
                    {title}
                    {pro && <span className="md:hidden"> · Pro</span>}
                  </h3>
                  <p className="text-sm leading-[1.7] text-ink-2 md:text-[15px]">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="bg-pop-soft/50">
        <div className={`${container} flex flex-col gap-10 py-16 md:gap-12 md:py-28`}>
          <div className="flex flex-col gap-3 md:items-center md:gap-4 md:text-center">
            <span className={cn(tag, "bg-pop-soft text-pop-ink md:self-center")}>요금</span>
            <h2 className={h2}>필요한 만큼만 쓰세요</h2>
            <p className="text-[15px] leading-[1.7] text-ink-2 md:text-[17px]">
              모든 플랜은 월 단위 자동 결제이며 언제든 해지할 수 있어요. 금액은 VAT 포함이에요.
            </p>
          </div>
          <PricingCards />
          <p className="text-center text-[13px] leading-normal text-muted-foreground md:text-sm md:leading-[1.7]">
            DM 한도는 매월 1일(한국 시간)에 초기화돼요 · Pro는 결제 즉시 시작되고, 해지는 결제 기간이 끝날 때 적용돼요 · 여러 계정용 요금제는 준비 중이에요
          </p>
        </div>
      </section>

      <section id="faq" className={`${container} grid gap-6 py-16 md:grid-cols-12 md:gap-10 md:py-28`}>
        <h2 className={`${h2} md:col-span-4`}>
          자주 묻는
          <br className="hidden md:block" /> 질문
        </h2>
        <div className="flex flex-col gap-3 md:col-span-8">
          {faqs.map((f, i) => (
            <details key={f.q} open={i === 0} className="group rounded-3xl border-2 border-foreground bg-card px-5 py-4 open:bg-brand/25 md:px-7 md:py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-bold md:text-[19px]">
                {f.q}
                <Plus className="size-5 shrink-0 transition-transform group-open:rotate-45" aria-hidden />
              </summary>
              <p className="mt-2.5 text-sm leading-[1.7] text-ink-2 md:mt-3 md:text-base">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className={`${container} pb-16 md:pb-28`}>
        <div className="flex flex-col gap-6 rounded-[32px] bg-brand px-6 py-10 md:flex-row md:items-center md:justify-between md:gap-10 md:rounded-[44px] md:px-14 md:py-16">
          <h2 className="font-display text-[32px] leading-[1.22] tracking-[-0.02em] md:text-[52px] md:leading-[1.15]">
            다음 공구 게시물부터,
            <br />
            댓글 DM은 자동으로.
          </h2>
          <Link href="/login" className={cn(cta, "shrink-0 bg-foreground px-8 text-white")}>
            무료로 시작하기
            <ArrowRight className="size-5" aria-hidden />
          </Link>
        </div>
      </section>
    </>
  );
}
