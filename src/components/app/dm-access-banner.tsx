import { MessageSquareOff } from "lucide-react";
import { MESSAGE_ACCESS_STEPS } from "@/lib/onboarding";

export function DmAccessBanner({ accounts }: { accounts: { username: string; status: string; dmBlocked: boolean }[] }) {
  // 다시 연결이 필요한 계정은 재연결 배너가 먼저 안내한다
  const blocked = accounts.filter((a) => a.dmBlocked && a.status === "active");
  if (blocked.length === 0) return null;
  return (
    <div role="alert" className="flex gap-3 rounded-2xl bg-warning-soft p-4 text-sm text-warning-ink">
      <MessageSquareOff className="mt-0.5 size-[18px] shrink-0" aria-hidden />
      <div className="flex flex-col gap-2">
        <p className="font-semibold">DM이 막혀 있어요</p>
        <p className="leading-relaxed">
          {blocked.map((a) => `@${a.username}`).join(", ")} 계정에서 ‘메시지 접근 허용’이 꺼져 있어서 DM을 보내지 못했어요. 인스타 앱에서
          켜 주세요.
        </p>
        <ol className="flex list-decimal flex-col gap-1 pl-5 leading-relaxed">
          {MESSAGE_ACCESS_STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="text-xs">켜고 나면 다음 댓글부터 다시 DM이 나가요.</p>
      </div>
    </div>
  );
}
