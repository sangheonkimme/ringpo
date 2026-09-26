import { Check, Link2, Lock, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { MESSAGE_ACCESS_STEPS, setupProgress, type StepState } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

function StepBadge({ state, n }: { state: StepState; n: number }) {
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
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-[15px] font-bold",
        state === "current" ? "bg-foreground text-white" : "bg-neutral-soft text-ink-2",
      )}
    >
      {n}
    </span>
  );
}

function stepCard(state: StepState) {
  return cn(
    "flex flex-col gap-3.5 rounded-[18px] p-5",
    state === "current" && "border-2 border-foreground bg-card",
    (state === "done" || state === "upcoming") && "border bg-card",
    state === "locked" && "border border-dashed border-input",
  );
}

export function OnboardingSteps({
  accounts,
  connected,
  hasAutomation,
}: {
  accounts: { id: string; username: string; status: string; dmBlocked: boolean }[];
  connected: boolean;
  hasAutomation: boolean;
}) {
  const dmBlocked = accounts.some((a) => a.status === "active" && a.dmBlocked);
  const p = setupProgress({ connected, dmBlocked, hasAutomation });
  const [s1, s2, s3] = p.steps;
  const firstOpen = p.steps.indexOf("current");

  return (
    <>
      <div role="img" aria-label={`3단계 중 ${p.doneCount}단계 완료`} className="grid grid-cols-3 gap-1.5">
        {p.steps.map((state, i) => (
          <span key={i} className={cn("h-1.5 rounded-full", state === "done" ? "bg-foreground" : i === firstOpen ? "bg-brand" : "bg-border")} />
        ))}
      </div>

      <section className={stepCard(s1)}>
        <div className="flex items-center gap-3">
          <StepBadge state={s1} n={1} />
          <h2 className="text-[17px] font-bold">인스타그램 연결</h2>
        </div>
        {accounts.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {accounts.map((a) => (
              <li key={a.id}>
                @{a.username} · {a.status === "active" ? "연결됨" : "다시 연결 필요"}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm leading-[1.7] text-ink-2">인스타그램 공식 로그인 창에서 ‘허용’만 누르면 끝나요. 비밀번호는 저장하지 않아요.</p>
        {!connected && (
          <p className="rounded-xl bg-accent px-3.5 py-3 text-[13px] leading-relaxed">
            개인 계정이면 연결 중에 인스타그램이 <b>‘프로페셔널 계정으로 변경하시겠어요?’</b>라고 물어요. <b>변경</b>을 누르면 무료로 바로
            전환돼요.
          </p>
        )}
        <a
          href="/api/instagram/connect"
          className={cn(
            "flex h-[54px] items-center justify-center gap-2.5 rounded-xl text-base font-semibold",
            s1 === "current" ? "bg-foreground text-white" : "border-[1.5px] border-foreground",
          )}
        >
          <Link2 className="size-[18px]" aria-hidden />
          {connected ? "다른 계정 연결 · 다시 연결" : "인스타그램으로 연결하기"}
        </a>
        <p className="text-xs leading-relaxed text-muted-foreground">
          연결하면 댓글 읽기·답글 달기·메시지 보내기 권한을 사용해요. 계정이 공개 상태여야 댓글 알림을 받아요.
        </p>
      </section>

      <section className={stepCard(s2)}>
        <div className="flex items-center gap-3">
          <StepBadge state={s2} n={2} />
          <h2 className="text-[17px] font-bold">메시지 접근 허용</h2>
        </div>
        {!connected && (
          <p className="text-sm leading-[1.7] text-ink-2">
            연결 창에 나오는 <b>‘메시지 액세스 허용’</b>을 켠 채로 허용을 누르면 자동으로 끝나요. 꺼져 있으면 DM이 나가지 않아요.
          </p>
        )}
        {s2 === "done" && <p className="text-sm leading-[1.7] text-ink-2">연결할 때 켜졌어요. 인스타 설정에서 끄면 DM이 나가지 않으니 켜 두세요.</p>}
        {dmBlocked && (
          <div className="flex flex-col gap-3 rounded-xl bg-warning-soft p-3.5 text-warning-ink">
            <p className="flex gap-2 text-sm font-semibold">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              ‘메시지 접근 허용’이 꺼져 있어서 DM을 보내지 못했어요
            </p>
            <ol className="ml-6 flex list-decimal flex-col gap-1.5 pl-1 text-sm leading-relaxed">
              {MESSAGE_ACCESS_STEPS.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="text-xs leading-relaxed">켜고 나면 다음 DM부터 정상으로 나가요. 메뉴 이름은 앱 버전에 따라 조금 다를 수 있어요.</p>
          </div>
        )}
      </section>

      <section className={stepCard(s3)}>
        <div className="flex items-center gap-3">
          <StepBadge state={s3} n={3} />
          <h2 className={cn("text-[17px] font-bold", s3 === "locked" && "text-muted-foreground")}>첫 자동화 만들기</h2>
        </div>
        {s3 === "locked" ? (
          <p className="text-sm leading-relaxed text-muted-foreground">인스타그램을 연결하면 열려요.</p>
        ) : (
          <Link
            href="/app/automations/new"
            className={cn(
              "flex h-[54px] items-center justify-center rounded-xl text-base font-semibold",
              s3 === "upcoming" ? "border-[1.5px] border-foreground" : "bg-foreground text-white",
            )}
          >
            자동화 만들기
          </Link>
        )}
      </section>
    </>
  );
}
