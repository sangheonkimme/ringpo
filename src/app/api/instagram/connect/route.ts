import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomToken } from "@/server/crypto";
import { getEnv } from "@/server/env";
import { IG_STATE_COOKIE } from "@/server/instagram/connect";
import { buildAuthorizeUrl } from "@/server/instagram/oauth";
import { getSessionUser } from "@/server/session";

export async function GET() {
  const env = getEnv();
  if (!(await getSessionUser())) return NextResponse.redirect(new URL("/login", env.APP_URL));
  const state = randomToken(24);
  (await cookies()).set(IG_STATE_COOKIE, state, {
    httpOnly: true,
    secure: env.APP_URL.startsWith("https://"),
    sameSite: "lax",
    maxAge: 600,
    path: "/api/instagram",
  });
  return NextResponse.redirect(
    buildAuthorizeUrl({ appId: env.IG_APP_ID, redirectUri: `${env.APP_URL}/api/instagram/callback`, state }),
  );
}
