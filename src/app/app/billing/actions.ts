"use server";

import { revalidatePath } from "next/cache";
import { scheduleDowngrade, setCancelAtPeriodEnd } from "@/server/billing/subscriptions";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";

export async function cancelSubscriptionAction(): Promise<boolean> {
  const user = await requireUser();
  const ok = await setCancelAtPeriodEnd(getDb(), user.id, true);
  revalidatePath("/app/billing");
  return ok;
}

export async function resumeSubscriptionAction(): Promise<boolean> {
  const user = await requireUser();
  const ok = await setCancelAtPeriodEnd(getDb(), user.id, false);
  revalidatePath("/app/billing");
  return ok;
}

export async function scheduleDowngradeAction(plan: "pro" | null): Promise<boolean> {
  const user = await requireUser();
  const ok = await scheduleDowngrade(getDb(), user.id, plan === "pro" ? "pro" : null);
  revalidatePath("/app/billing");
  return ok;
}
