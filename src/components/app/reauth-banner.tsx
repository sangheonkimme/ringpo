import { TriangleAlert } from "lucide-react";

export function ReauthBanner({ accounts }: { accounts: { username: string; status: string }[] }) {
  const broken = accounts.filter((a) => a.status === "reauth_required");
  if (broken.length === 0) return null;
  return (
    <div role="alert" className="flex gap-3 rounded-2xl bg-danger-soft p-4 text-sm text-danger-ink">
      <TriangleAlert className="mt-0.5 size-[18px] shrink-0" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="font-semibold">인스타그램 연결이 끊겼어요</p>
        <p>
          {broken.map((a) => `@${a.username}`).join(", ")} 계정의 자동 응답이 멈췄어요.{" "}
          <a href="/api/instagram/connect" className="font-semibold underline">
            다시 연결하기
          </a>
        </p>
      </div>
    </div>
  );
}
