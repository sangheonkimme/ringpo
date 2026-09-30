import { NextResponse } from "next/server";
import { z } from "zod";
import { canSubscribe } from "@/lib/plans";
import { createBillingDeps } from "@/server/billing/deps";
import { billingConfigured } from "@/server/billing/gateway";
import { getUserPlan } from "@/server/billing/plan-of";
import { subscribe } from "@/server/billing/subscriptions";
import { getDb } from "@/server/db/client";
import { errorFields, log } from "@/server/log";
import { getSessionUser } from "@/server/session";

const bodySchema = z.object({
  plan: z.enum(["pro", "agency"]),
  billingKey: z.string().min(1).max(300),
  customerName: z.string().trim().min(1).max(50).optional(),
  customerPhone: z.string().regex(/^0\d{8,10}$/).optional(),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "로그인이 필요해요" }, { status: 401 });
  if (!billingConfigured()) return NextResponse.json({ ok: false, error: "결제 설정이 아직 준비되지 않았어요" }, { status: 503 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "잘못된 요청이에요" }, { status: 400 });
  const current = await getUserPlan(getDb(), user.id);
  if (!canSubscribe(parsed.data.plan, current.id)) {
    return NextResponse.json({ ok: false, error: "지금은 가입할 수 없는 플랜이에요" }, { status: 400 });
  }
  try {
    const res = await subscribe(createBillingDeps(getDb()), { userId: user.id, email: user.email, ...parsed.data });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (e) {
    log.error("subscribe failed", errorFields(e));
    return NextResponse.json(
      { ok: false, error: "결제 확인 중 오류가 발생했어요. 결제 내역을 확인한 뒤 다시 시도해주세요" },
      { status: 502 },
    );
  }
}
