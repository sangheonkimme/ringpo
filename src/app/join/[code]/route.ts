import { NextResponse } from "next/server";
import { activeReportReferral, parseReportReferral, referralCookieValue, REPORT_REFERRAL_COOKIE, REPORT_REFERRAL_SECONDS, signReportReferral } from "@/server/campaigns/report-referrals";
import { REPORT_HEADERS } from "@/server/campaigns/report-shares";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { countCampaignClick } from "@/server/campaigns/links";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const env = getEnv(); const { code } = await params; const now = new Date();
  const target = new URL("/login", env.APP_URL); target.searchParams.set("utm_source", "ringpo"); target.searchParams.set("utm_medium", "report"); target.searchParams.set("utm_campaign", "brand_report");
  const response = NextResponse.redirect(target, 302);
  for (const [key, value] of Object.entries(REPORT_HEADERS)) response.headers.set(key, value);
  if (!countCampaignClick(request)) return response;
  const existing = parseReportReferral(referralCookieValue(request.headers.get("cookie")), now, env.BETTER_AUTH_SECRET);
  if (!existing && await activeReportReferral(getDb(), code, now)) response.cookies.set(REPORT_REFERRAL_COOKIE, signReportReferral(code, now, env.BETTER_AUTH_SECRET), { httpOnly: true, sameSite: "lax", secure: new URL(env.APP_URL).protocol === "https:", path: "/", maxAge: REPORT_REFERRAL_SECONDS });
  return response;
}
