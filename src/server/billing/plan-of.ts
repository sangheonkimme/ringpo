import { eq } from "drizzle-orm";
import { PLANS, type Plan, type PlanId } from "@/lib/plans";
import type { Executor } from "@/server/db/client";
import { subscriptions } from "@/server/db/schema";

export function effectivePlan(sub: { plan: PlanId; status: string } | null | undefined): Plan {
  if (!sub || sub.status === "canceled") return PLANS.free;
  return PLANS[sub.plan];
}

export async function getUserPlan(db: Executor, userId: string): Promise<Plan> {
  const [sub] = await db
    .select({ plan: subscriptions.plan, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  return effectivePlan(sub);
}
