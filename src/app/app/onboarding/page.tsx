import { OnboardingSteps } from "@/components/app/onboarding-steps";
import { listAutomations } from "@/server/automations/service";
import { getDb } from "@/server/db/client";
import { getDashboard } from "@/server/dashboard";
import { requireUser } from "@/server/session";

export const metadata = { title: "시작하기" };

const ERRORS: Record<string, string> = {
  denied: "인스타그램 연결을 취소했어요.",
  state: "보안 확인에 실패했어요. 다시 시도해주세요.",
  oauth_failed: "인스타그램 인증에 실패했어요. 잠시 후 다시 시도해주세요.",
  not_professional:
    "비즈니스·크리에이터 계정만 연결할 수 있어요. 다시 연결하고 인스타그램이 ‘프로페셔널 계정으로 변경’을 물으면 ‘변경’을 눌러 주세요. 직접 바꾸려면 프로필 → ☰ → 설정 및 활동 → 계정 유형 및 도구에서 전환할 수 있어요.",
  owned_by_other: "이미 다른 회원이 연결한 인스타그램 계정이에요.",
  limit: "현재 플랜에서 연결할 수 있는 인스타그램 계정 수를 넘었어요.",
  subscribe_failed: "댓글 알림 구독에 실패했어요. 다시 연결해주세요.",
};

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const d = await getDashboard(getDb(), user.id, new Date());
  const autos = await listAutomations(getDb(), user.id);
  const connected = d.accounts.some((a) => a.status === "active");

  return (
    <main className="flex flex-col gap-4 px-5 pb-28 pt-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[28px] font-extrabold tracking-[-0.03em]">3단계로 시작해요</h1>
        <p className="text-[15px] leading-relaxed text-ink-2">인스타 계정을 연결하면 바로 첫 자동화를 만들 수 있어요.</p>
      </div>
      {sp.error && ERRORS[sp.error] && (
        <p role="alert" className="rounded-2xl bg-danger-soft p-4 text-sm text-danger-ink">
          {ERRORS[sp.error]}
        </p>
      )}
      {sp.connected && <p className="rounded-2xl bg-success-soft p-4 text-sm text-success-ink">인스타그램 계정이 연결됐어요!</p>}

      <OnboardingSteps
        accounts={d.accounts.map((a) => ({ id: a.id, username: a.username, status: a.status, dmBlocked: a.dmBlocked }))}
        connected={connected}
        hasAutomation={autos.length > 0}
      />
    </main>
  );
}
