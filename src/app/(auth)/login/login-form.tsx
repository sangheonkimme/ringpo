"use client";

import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

const KAKAO_ICON =
  "M12 4C6.5 4 2 7.4 2 11.6c0 2.7 1.8 5 4.6 6.4l-1 3.6c-.1.3.3.6.6.4l4.2-2.8c.5.1 1 .1 1.6.1 5.5 0 10-3.4 10-7.7S17.5 4 12 4z";

export function LoginForm({ kakao, google }: { kakao: boolean; google: boolean }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function social(provider: "kakao" | "google") {
    setPending(true);
    const { error } = await authClient.signIn.social({ provider, callbackURL: "/app" });
    if (error) {
      toast.error(error.message ?? "로그인에 실패했어요");
      setPending(false);
    }
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const { error } = await authClient.signIn.magicLink({ email, callbackURL: "/app" });
    setPending(false);
    if (error) toast.error(error.message ?? "메일 발송에 실패했어요");
    else setSent(true);
  }

  if (sent) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-center text-sm">
        <p className="font-semibold">{email}로 로그인 링크를 보냈어요</p>
        <p className="mt-1 text-muted-foreground">메일함에서 링크를 눌러주세요. 5분간 유효해요.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {(kakao || google) && (
        <div className="flex flex-col gap-3">
          {kakao && (
            <button
              type="button"
              disabled={pending}
              onClick={() => social("kakao")}
              className="flex h-[54px] items-center justify-center gap-2.5 rounded-xl bg-[#FEE500] text-base font-semibold text-[#191919] disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" className="size-5 fill-[#191919]" aria-hidden>
                <path d={KAKAO_ICON} />
              </svg>
              카카오로 시작하기
            </button>
          )}
          {google && (
            <button
              type="button"
              disabled={pending}
              onClick={() => social("google")}
              className="h-[54px] rounded-xl border border-input bg-card text-base font-semibold disabled:opacity-60"
            >
              Google로 시작하기
            </button>
          )}
        </div>
      )}
      {(kakao || google) && (
        <div className="-my-4 flex items-center gap-3 text-[13px] text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          또는
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      <form onSubmit={sendLink} className="flex flex-col gap-3">
        <label htmlFor="login-email" className="text-sm font-semibold">
          이메일
        </label>
        <input
          id="login-email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-[52px] rounded-xl border border-input bg-card px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-[54px] rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60"
        >
          이메일로 로그인 링크 받기
        </button>
      </form>
    </div>
  );
}
