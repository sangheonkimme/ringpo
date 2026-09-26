import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { getUserPlan } from "@/server/billing/plan-of";
import type { AutomationInput } from "@/lib/automation-schema";
import type { Db } from "@/server/db/client";
import { automations, igAccounts, type Automation } from "@/server/db/schema";
import { normalizeText } from "./matcher";

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

export type SaveResult =
  | { ok: true; id: string; activated: boolean; activationError?: "limit" | "account_inactive" }
  | { ok: false; error: string };

function isSelfShortLink(url: string, appUrl: string): boolean {
  try {
    const u = new URL(url);
    return u.host === new URL(appUrl).host && u.pathname.startsWith("/l/");
  } catch {
    return false;
  }
}

function dedupeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keywords) {
    const trimmed = k.trim();
    const key = normalizeText(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function toColumns(input: AutomationInput) {
  const specific = input.mediaScope === "specific" && input.media;
  return {
    igAccountId: input.igAccountId,
    name: input.name,
    mediaScope: input.mediaScope,
    mediaId: specific ? input.media!.id : null,
    mediaThumbnailUrl: specific ? input.media!.thumbnailUrl : null,
    mediaPermalink: specific ? input.media!.permalink : null,
    mediaCaption: specific ? input.media!.caption : null,
    keywords: dedupeKeywords(input.keywords),
    matchType: input.matchType,
    replyEnabled: input.replyEnabled,
    replyTexts: input.replyEnabled ? input.replyTexts : [],
    dmText: input.dmText,
    dmButtonTitle: input.dmButtonTitle,
    dmLinkUrl: input.dmLinkUrl,
    followGate: input.followGate,
    followGateText: input.followGateText,
  };
}

async function validateOwnership(db: Db, userId: string, input: AutomationInput, appUrl: string): Promise<string | null> {
  const [acct] = await db
    .select({ id: igAccounts.id })
    .from(igAccounts)
    .where(and(eq(igAccounts.id, input.igAccountId), eq(igAccounts.userId, userId), ne(igAccounts.status, "disconnected")))
    .limit(1);
  if (!acct) return "인스타 계정을 찾을 수 없어요";
  if (isSelfShortLink(input.dmLinkUrl, appUrl)) return "이 서비스의 단축 링크는 넣을 수 없어요";
  return null;
}

async function applyActivation(db: Db, userId: string, id: string, activate: boolean): Promise<SaveResult> {
  const res = await setAutomationActive(db, userId, id, activate);
  if (res.ok) return { ok: true, id, activated: activate };
  if (res.reason === "not_found") return { ok: false, error: "자동화를 찾을 수 없어요" };
  return { ok: true, id, activated: false, activationError: res.reason };
}

export async function createAutomation(
  db: Db,
  userId: string,
  input: AutomationInput,
  opts: { appUrl: string; activate: boolean },
): Promise<SaveResult> {
  const error = await validateOwnership(db, userId, input, opts.appUrl);
  if (error) return { ok: false, error };
  const [row] = await db
    .insert(automations)
    .values({ userId, ...toColumns(input), isActive: false })
    .returning({ id: automations.id });
  return applyActivation(db, userId, row.id, opts.activate);
}

export async function updateAutomation(
  db: Db,
  userId: string,
  id: string,
  input: AutomationInput,
  opts: { appUrl: string; activate: boolean },
): Promise<SaveResult> {
  const error = await validateOwnership(db, userId, input, opts.appUrl);
  if (error) return { ok: false, error };
  const rows = await db
    .update(automations)
    .set(toColumns(input))
    .where(and(eq(automations.id, id), eq(automations.userId, userId)))
    .returning({ id: automations.id, isActive: automations.isActive });
  if (rows.length === 0) return { ok: false, error: "자동화를 찾을 수 없어요" };
  // '저장만'은 켜짐/꺼짐 상태를 그대로 둔다. 끄는 것은 토글로만 한다
  if (!opts.activate) return { ok: true, id, activated: rows[0].isActive };
  return applyActivation(db, userId, id, true);
}
