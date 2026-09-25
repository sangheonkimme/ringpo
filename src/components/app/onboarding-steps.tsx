"use client";

import { Check, Link2, Lock } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { MESSAGE_ACCESS_STEPS, setupProgress, type StepState } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

const KEY = "ringpo:setup-checklist";
const EVENT = "ringpo:setup-checklist";

interface Checks {
  messageAccess: boolean;
}

// 브라우저 저장소가 막혀 있어도(사생활 보호 모드 등) 체크는 동작하도록 메모리에도 둔다
let memory = "";

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

function readRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

function parse(raw: string): Checks {
  try {
    const v = JSON.parse(raw) as Partial<Checks>;
    return { messageAccess: v.messageAccess === true };
  } catch {
    return { messageAccess: false };
  }
}

function save(next: Checks) {
  memory = JSON.stringify(next);
  try {
    localStorage.setItem(KEY, memory);
  } catch {
    // 메모리 값으로 계속 동작한다
  }
  window.dispatchEvent(new Event(EVENT));
}

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
    state === "locked" && "border border-dashed border-[#D3DBE5]",
  );
}

function ChecklistItem(props: {
  id: string;
  title: string;
  hint: string;
  steps: string[];
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { id, title, hint, steps, checked, onChange } = props;
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl p-3.5", checked ? "bg-success-soft/60" : "bg-background")}>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-foreground"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold">{title}</span>
          <span className="text-[13px] leading-relaxed text-ink-2">{hint}</span>
        </span>
      </label>
      {!checked && (
        <ol className="ml-8 flex list-decimal flex-col gap-1.5 pl-4 text-sm leading-relaxed text-ink-2">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function OnboardingSteps({
  accounts,
  connected,
  hasAutomation,
}: {
  accounts: { id: string; username: string; status: string }[];
  connected: boolean;
  hasAutomation: boolean;
}) {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "");
  const checks = parse(raw);
  const p = setupProgress({ connected, hasAutomation, ...checks });
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
          <h2 className="text-[17px] font-bold">인스타 앱에서 ‘메시지 접근 허용’ 켜기</h2>
        </div>
        <ChecklistItem
          id="check-message-access"
          title="‘메시지 접근 허용’을 켰어요"
          hint="꺼져 있으면 댓글 단 사람에게 DM이 나가지 않아요. 인스타그램 앱에서 한 번만 켜 두면 돼요."
          steps={MESSAGE_ACCESS_STEPS}
          checked={checks.messageAccess}
          onChange={(v) => save({ ...checks, messageAccess: v })}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">메뉴 이름은 앱 버전에 따라 조금 다를 수 있어요.</p>
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
