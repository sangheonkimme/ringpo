import { NextResponse } from "next/server";
import { z } from "zod";
import { CampaignError } from "@/server/campaigns/access";
import { getCampaignForecast } from "@/server/campaigns/forecast";
import { getDb } from "@/server/db/client";
import { getSessionUser } from "@/server/session";

const query = z.object({ accountId: z.uuid(), campaignId: z.uuid().optional(), openAt: z.iso.datetime({ offset: true }), closeAt: z.iso.datetime({ offset: true }), hourlyRate: z.coerce.number().int().positive(), expiryFallback: z.enum(["true", "false"]) });
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요" }, { status: 401, headers });
  const input = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!input.success) return NextResponse.json({ error: "공구 일정과 발송 속도를 확인해주세요" }, { status: 400, headers });
  const value = input.data;
  try {
    const forecast = await getCampaignForecast(getDb(), user.id, value.accountId, value.campaignId, { openAt: new Date(value.openAt), closeAt: new Date(value.closeAt), hourlyRate: value.hourlyRate, expiryFallbackEnabled: value.expiryFallback === "true" });
    return NextResponse.json(forecast, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof CampaignError ? error.message : "발송 예측을 불러오지 못했어요" }, { status: error instanceof CampaignError ? error.code === "not_found" ? 404 : 400 : 503, headers });
  }
}
