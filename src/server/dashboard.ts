import { and, desc, eq, gt, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { MESSAGE_ACCESS_OFF } from "@/server/instagram/errors";
import type { Plan } from "@/lib/plans";
import { getUserPlan } from "@/server/billing/plan-of";
import type { Db } from "@/server/db/client";
import { automations, commentEvents, igAccounts, links } from "@/server/db/schema";
import { getDmUsage } from "@/server/usage";

export interface AutomationStats {
  total: number;
  succeeded: number;
  partial: number;
  failed: number;
  pending: number;
  linksSent: number;
  linksClicked: number;
  clicks: number;
}

const EMPTY: AutomationStats = { total: 0, succeeded: 0, partial: 0, failed: 0, pending: 0, linksSent: 0, linksClicked: 0, clicks: 0 };

const eventFields = {
  id: commentEvents.id,
  createdAt: commentEvents.createdAt,
  status: commentEvents.status,
  skipReason: commentEvents.skipReason,
  errorCode: commentEvents.errorCode,
  commenterUsername: commentEvents.commenterUsername,
  commentText: commentEvents.commentText,
  replyStatus: commentEvents.replyStatus,
  dmStatus: commentEvents.dmStatus,
  automationName: automations.name,
};

export type EventRow = Awaited<ReturnType<typeof getAutomationEvents>>[number];

async function statsByAutomation(db: Db, automationIds: string[]): Promise<Map<string, AutomationStats>> {
  const out = new Map<string, AutomationStats>();
  if (automationIds.length === 0) return out;
  const ev = await db
    .select({
      automationId: commentEvents.automationId,
      total: sql<number>`count(*)::int`,
      succeeded: sql<number>`(count(*) filter (where ${commentEvents.status} = 'succeeded'))::int`,
      partial: sql<number>`(count(*) filter (where ${commentEvents.status} = 'partial'))::int`,
      failed: sql<number>`(count(*) filter (where ${commentEvents.status} in ('failed', 'expired')))::int`,
      pending: sql<number>`(count(*) filter (where ${commentEvents.status} in ('pending', 'processing')))::int`,
    })
    .from(commentEvents)
    .where(inArray(commentEvents.automationId, automationIds))
    .groupBy(commentEvents.automationId);
  const lk = await db
    .select({
      automationId: links.automationId,
      linksSent: sql<number>`count(*)::int`,
      linksClicked: sql<number>`(count(*) filter (where ${links.clickCount} > 0))::int`,
      clicks: sql<number>`coalesce(sum(${links.clickCount}), 0)::int`,
    })
    .from(links)
    .where(inArray(links.automationId, automationIds))
    .groupBy(links.automationId);
  for (const id of automationIds) out.set(id, { ...EMPTY });
  for (const r of ev) {
    const s = r.automationId ? out.get(r.automationId) : undefined;
    if (s) Object.assign(s, { total: r.total, succeeded: r.succeeded, partial: r.partial, failed: r.failed, pending: r.pending });
  }
  for (const r of lk) {
    const s = r.automationId ? out.get(r.automationId) : undefined;
    if (s) Object.assign(s, { linksSent: r.linksSent, linksClicked: r.linksClicked, clicks: r.clicks });
  }
  return out;
}

/** 계정별 가장 최근 DM 결과가 '메시지 접근 허용 꺼짐' 실패인 계정. 다음 DM이 성공하면 풀린다 */
async function dmBlockedAccountIds(db: Db, accountIds: string[]): Promise<Set<string>> {
  if (accountIds.length === 0) return new Set();
  const latest = await db
    .selectDistinctOn([commentEvents.igAccountId], { igAccountId: commentEvents.igAccountId, dmStatus: commentEvents.dmStatus, errorCode: commentEvents.errorCode })
    .from(commentEvents)
    .where(and(inArray(commentEvents.igAccountId, accountIds), inArray(commentEvents.dmStatus, ["sent", "failed"]), isNotNull(commentEvents.completedAt)))
    .orderBy(commentEvents.igAccountId, desc(commentEvents.completedAt));
  return new Set(latest.filter((r) => r.dmStatus === "failed" && r.errorCode === MESSAGE_ACCESS_OFF).map((r) => r.igAccountId));
}

export async function getDashboard(db: Db, userId: string, now: Date) {
  const plan: Plan = await getUserPlan(db, userId);
  const accountRows = await db
    .select({ id: igAccounts.id, username: igAccounts.username, status: igAccounts.status, profilePictureUrl: igAccounts.profilePictureUrl })
    .from(igAccounts)
    .where(and(eq(igAccounts.userId, userId), ne(igAccounts.status, "disconnected")));
  const blocked = await dmBlockedAccountIds(db, accountRows.map((a) => a.id));
  const accounts = accountRows.map((a) => ({ ...a, dmBlocked: blocked.has(a.id) }));
  const autos = await db
    .select({
      id: automations.id,
      name: automations.name,
      isActive: automations.isActive,
      mediaScope: automations.mediaScope,
      mediaThumbnailUrl: automations.mediaThumbnailUrl,
      keywords: automations.keywords,
      matchType: automations.matchType,
    })
    .from(automations)
    .where(eq(automations.userId, userId))
    .orderBy(desc(automations.createdAt));
  const stats = await statsByAutomation(db, autos.map((a) => a.id));

  const [{ waiting }] = await db
    .select({ waiting: sql<number>`count(*)::int` })
    .from(commentEvents)
    .innerJoin(igAccounts, eq(igAccounts.id, commentEvents.igAccountId))
    .where(
      and(
        eq(igAccounts.userId, userId),
        eq(commentEvents.status, "pending"),
        isNotNull(commentEvents.automationId),
        gt(commentEvents.runAt, now),
      ),
    );

  const recent = await db
    .select(eventFields)
    .from(commentEvents)
    .innerJoin(automations, eq(automations.id, commentEvents.automationId))
    .where(eq(automations.userId, userId))
    .orderBy(desc(commentEvents.createdAt))
    .limit(20);

  return {
    plan,
    accounts,
    usage: await getDmUsage(db, userId, now),
    waiting,
    automations: autos.map((a) => ({ ...a, stats: stats.get(a.id) ?? { ...EMPTY } })),
    recent,
  };
}

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;

export async function getAutomationEvents(db: Db, userId: string, automationId: string, limit = 50) {
  return db
    .select(eventFields)
    .from(commentEvents)
    .innerJoin(automations, eq(automations.id, commentEvents.automationId))
    .where(and(eq(automations.userId, userId), eq(automations.id, automationId)))
    .orderBy(desc(commentEvents.createdAt))
    .limit(limit);
}

export async function getAutomationStats(db: Db, automationId: string): Promise<AutomationStats> {
  return (await statsByAutomation(db, [automationId])).get(automationId) ?? { ...EMPTY };
}
