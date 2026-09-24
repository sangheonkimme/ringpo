import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { getEnv } from "@/server/env";
import { getSessionUser } from "@/server/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "로그인" };

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/app");
  const env = getEnv();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col gap-10 px-6 pb-10 pt-16">
      <div className="flex flex-col items-center gap-5 text-center">
        <Logo href="/" size="lg" />
        <h1 className="font-display text-[30px] font-extrabold leading-[1.3] tracking-[-0.03em]">
          댓글 하나로
          <br />
          DM 링크까지, 자동으로
        </h1>
        <p className="text-[15px] text-ink-2">가입하고 3분이면 첫 자동화를 켤 수 있어요.</p>
      </div>
      <LoginForm
        kakao={Boolean(env.KAKAO_CLIENT_ID && env.KAKAO_CLIENT_SECRET)}
        google={Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)}
      />
      <p className="mt-auto text-center text-xs leading-relaxed text-muted-foreground">
        로그인하면{" "}
        <Link href="/terms" className="underline">
          이용약관
        </Link>
        과{" "}
        <Link href="/privacy" className="underline">
          개인정보처리방침
        </Link>
        에
        <br />
        동의하게 됩니다.
      </p>
    </main>
  );
}
