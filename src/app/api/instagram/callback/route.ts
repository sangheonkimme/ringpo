import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { encryptSecret, safeEqual } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { getGraphClient } from "@/server/instagram/client";
import { connectInstagramAccount, IG_STATE_COOKIE } from "@/server/instagram/connect";
import { exchangeCodeForToken, exchangeForLongLivedToken } from "@/server/instagram/oauth";
import { getSessionUser } from "@/server/session";

export async function GET(req: Request) {
  const env = getEnv();
  const url = new URL(req.url);
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.APP_URL));

  const jar = await cookies();
  const expected = jar.get(IG_STATE_COOKIE)?.value;
  jar.delete({ name: IG_STATE_COOKIE, path: "/api/instagram" });
  const fail = (reason: string) => NextResponse.redirect(new URL(`/app/onboarding?error=${reason}`, env.APP_URL));

  if (url.searchParams.get("error")) return fail("denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !expected || !safeEqual(state, expected)) return fail("state");

  const redirectUri = `${env.APP_URL}/api/instagram/callback`;
  const result = await connectInstagramAccount(
    {
      db: getDb(),
      graph: getGraphClient(),
      exchangeCode: (c) => exchangeCodeForToken({ appId: env.IG_APP_ID, appSecret: env.IG_APP_SECRET, redirectUri, code: c }),
      exchangeLongLived: (t) => exchangeForLongLivedToken({ appSecret: env.IG_APP_SECRET, shortToken: t }),
      encrypt: encryptSecret,
      now: () => new Date(),
    },
    { userId: user.id, code },
  );
  if (!result.ok) return fail(result.reason);
  return NextResponse.redirect(new URL("/app/onboarding?connected=1", env.APP_URL));
}
