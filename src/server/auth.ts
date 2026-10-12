import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { getDb } from "@/server/db/client";
import { account, session, user, verification } from "@/server/db/schema";
import { sendEmail } from "@/server/email";
import { emails } from "@/server/emails";
import { getEnv } from "@/server/env";

function createAuth() {
  const env = getEnv();
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (env.KAKAO_CLIENT_ID && env.KAKAO_CLIENT_SECRET) {
    socialProviders.kakao = { clientId: env.KAKAO_CLIENT_ID, clientSecret: env.KAKAO_CLIENT_SECRET };
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }
  return betterAuth({
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), { provider: "pg", schema: { user, session, account, verification } }),
    socialProviders,
    // 카카오는 미인증 이메일을 줄 수 있으므로 자동 연결을 신뢰하지 않는다(같은 이메일 계정 탈취 방지)
    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
    plugins: [
      magicLink({
        expiresIn: 300,
        sendMagicLink: async ({ email, url }) => {
          await sendEmail({ to: email, ...emails.magicLink(url) });
        },
      }),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
