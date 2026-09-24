import { Check, Link2, Lock } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { listAutomations } from "@/server/automations/service";
import { getDb } from "@/server/db/client";
import { getDashboard } from "@/server/dashboard";
import { requireUser } from "@/server/session";

export const metadata = { title: "시작하기" };

const ERRORS: Record<string, string> = {
  denied: "인스타그램 연결을 취소했어요.",
  state: "보안 확인에 실패했어요. 다시 시도해주세요.",
  oauth_failed: "인스타그램 인증에 실패했어요. 잠시 후 다시 시도해주세요.",
  not_professional: "비즈니스 또는 크리에이터 계정만 연결할 수 있어요. 아래 가이드대로 전환한 뒤 다시 연결해주세요.",
  owned_by_other: "이미 다른 회원이 연결한 인스타그램 계정이에요.",
  limit: "현재 플랜에서 연결할 수 있는 인스타그램 계정 수를 넘었어요.",
  subscribe_failed: "댓글 알림 구독에 실패했어요. 다시 연결해주세요.",
};

function StepBadge({ state, n }: { state: "done" | "current" | "locked"; n: number }) {
  if (state === "done") {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success-soft">
        <Check className="size-[18px] text-success-ink" strokeWidth={2.6} aria-hidden />
      </span>
    );
  }
  if (state === "locked") {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-soft text-muted-foreground">
        <Lock className="size-4" aria-hidden />
      </span>
    );
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-[15px] font-bold text-white">{n}</span>
  );
}

function stepCard(state: "done" | "current" | "locked") {
  return cn(
    "flex flex-col gap-3.5 rounded-[18px] p-5",
    state === "current" && "border-2 border-foreground bg-card",
    state === "done" && "border bg-card",
    state === "locked" && "border border-dashed border-[#D0C6B8]",
  );
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const d = await getDashboard(getDb(), user.id, new Date());
  const autos = await listAutomations(getDb(), user.id);
  const connected = d.accounts.some((a) => a.status === "active");
  const s1 = "done" as const;
  const s2 = connected ? "done" : "current";
  const s3 = !connected ? "locked" : autos.length > 0 ? "done" : "current";
  const progress = [true, connected, autos.length > 0];

  return (
    <main className="flex flex-col gap-4 px-5 pb-28 pt-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[28px] font-extrabold tracking-[-0.03em]">3단계로 시작해요</h1>
        <p className="text-[15px] leading-relaxed text-ink-2">인스타 계정을 연결하면 바로 첫 자동화를 만들 수 있어요.</p>
      </div>
      <div role="img" aria-label={`3단계 중 ${progress.filter(Boolean).length}단계 완료`} className="grid grid-cols-3 gap-1.5">
        {progress.map((done, i) => (
          <span key={i} className={cn("h-1.5 rounded-full", done ? "bg-foreground" : i === progress.indexOf(false) ? "bg-brand" : "bg-border")} />
        ))}
      </div>

      {sp.error && ERRORS[sp.error] && (
        <p role="alert" className="rounded-2xl bg-danger-soft p-4 text-sm text-danger-ink">
          {ERRORS[sp.error]}
        </p>
      )}
      {sp.connected && <p className="rounded-2xl bg-success-soft p-4 text-sm text-success-ink">인스타그램 계정이 연결됐어요!</p>}

      <section className={stepCard(s1)}>
        <div className="flex items-center gap-3">
          <StepBadge state={s1} n={1} />
          <h2 className="text-[17px] font-bold">프로페셔널 계정 준비</h2>
        </div>
        <p className="text-sm leading-[1.7] text-ink-2">
          인스타그램 정책상 비즈니스 또는 크리에이터 계정만 연결할 수 있어요. 계정이 공개 상태여야 댓글 알림을 받아요.
        </p>
        <ol className="flex list-decimal flex-col gap-2 rounded-xl bg-background py-3.5 pl-[34px] pr-4 text-sm leading-relaxed text-ink-2">
          <li>인스타그램 앱 → 프로필 → 오른쪽 위 메뉴</li>
          <li>설정 및 활동 → 계정 유형 및 도구</li>
          <li>프로페셔널 계정으로 전환 → 크리에이터 또는 비즈니스</li>
          <li>메시지 설정에서 ‘연결된 도구의 메시지 접근’ 허용</li>
        </ol>
      </section>

      <section className={stepCard(s2)}>
        <div className="flex items-center gap-3">
          <StepBadge state={s2} n={2} />
          <h2 className="text-[17px] font-bold">인스타그램 연결</h2>
        </div>
        {d.accounts.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {d.accounts.map((a) => (
              <li key={a.id}>
                @{a.username} · {a.status === "active" ? "연결됨" : "다시 연결 필요"}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm leading-[1.7] text-ink-2">인스타그램 공식 로그인 창에서 권한만 허용하면 돼요. 비밀번호는 저장하지 않아요.</p>
        <a
          href="/api/instagram/connect"
          className={cn(
            "flex h-[54px] items-center justify-center gap-2.5 rounded-xl text-base font-semibold",
            connected ? "border-[1.5px] border-foreground" : "bg-foreground text-white",
          )}
        >
          <Link2 className="size-[18px]" aria-hidden />
          {connected ? "다른 계정 연결 · 다시 연결" : "인스타그램으로 연결하기"}
        </a>
        <p className="text-xs leading-relaxed text-muted-foreground">연결하면 댓글 읽기·답글 달기·메시지 보내기 권한을 사용해요.</p>
      </section>

      <section className={stepCard(s3)}>
        <div className="flex items-center gap-3">
          <StepBadge state={s3} n={3} />
          <h2 className={cn("text-[17px] font-bold", s3 === "locked" && "text-muted-foreground")}>첫 자동화 만들기</h2>
        </div>
        {s3 === "locked" ? (
          <p className="text-sm leading-relaxed text-muted-foreground">인스타그램을 연결하면 열려요.</p>
        ) : (
          <Link href="/app/automations/new" className="flex h-[54px] items-center justify-center rounded-xl bg-foreground text-base font-semibold text-white">
            자동화 만들기
          </Link>
        )}
      </section>
    </main>
  );
}
