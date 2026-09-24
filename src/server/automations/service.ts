import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { getUserPlan } from "@/server/billing/plan-of";
import type { Db } from "@/server/db/client";
import { automations, igAccounts, type Automation } from "@/server/db/schema";

export type ToggleResult = { ok: true } | { ok: false; reason: "not_found" | "limit" | "account_inactive" };

export async function listAutomations(db: Db, userId: string) {
  return db
    .select({
      id: automations.id,
      name: automations.name,
      isActive: automations.isActive,
      mediaScope: automations.mediaScope,
      mediaThumbnailUrl: automations.mediaThumbnailUrl,
      keywords: automations.keywords,
      matchType: automations.matchType,
      igUsername: igAccounts.username,
      accountStatus: igAccounts.status,
      createdAt: automations.createdAt,
    })
    .from(automations)
    .innerJoin(igAccounts, eq(igAccounts.id, automations.igAccountId))
    .where(eq(automations.userId, userId))
    .orderBy(desc(automations.createdAt));
}

export async function getAutomation(db: Db, userId: string, id: string): Promise<Automation | null> {
  const [row] = await db
    .select()
    .from(automations)
    .where(and(eq(automations.id, id), eq(automations.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function setAutomationActive(db: Db, userId: string, id: string, active: boolean): Promise<ToggleResult> {
  const auto = await getAutomation(db, userId, id);
  if (!auto) return { ok: false, reason: "not_found" };
  if (!active) {
    await db.update(automations).set({ isActive: false }).where(eq(automations.id, id));
    return { ok: true };
  }
  const accounts = await db
    .select({ id: igAccounts.id, status: igAccounts.status })
    .from(igAccounts)
    .where(and(eq(igAccounts.userId, userId), ne(igAccounts.status, "disconnected")))
    .orderBy(asc(igAccounts.createdAt));
  const plan = await getUserPlan(db, userId);
  const index = accounts.findIndex((a) => a.id === auto.igAccountId);
  if (index === -1 || accounts[index].status !== "active") return { ok: false, reason: "account_inactive" };
  if (index >= plan.maxIgAccounts) return { ok: false, reason: "limit" };
  if (plan.maxActiveAutomations !== null) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(automations)
      .where(and(eq(automations.userId, userId), eq(automations.isActive, true), ne(automations.id, id)));
    if (count >= plan.maxActiveAutomations) return { ok: false, reason: "limit" };
  }
  await db.update(automations).set({ isActive: true }).where(eq(automations.id, id));
  return { ok: true };
}

export async function deleteAutomation(db: Db, userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(automations)
    .where(and(eq(automations.id, id), eq(automations.userId, userId)))
    .returning({ id: automations.id });
  return rows.length > 0;
}
