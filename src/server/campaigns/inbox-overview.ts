import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import { automations, messageEvents } from "@/server/db/schema";

/** Aggregate only; never return incoming text, user names, IDs or send payloads to this status panel. */
export async function messageInboxOverview(db: Executor, scope: SQL) {
  const [counts] = await db.select({
    total: sql<number>`count(*)::int`,
    pending: sql<number>`(count(*) filter (where ${messageEvents.status} in ('pending','leased')))::int`,
    failed: sql<number>`(count(*) filter (where ${messageEvents.status} = 'failed'))::int`,
    unknown: sql<number>`(count(*) filter (where ${messageEvents.status} = 'send_unknown'))::int`,
    expired: sql<number>`(count(*) filter (where ${messageEvents.status} = 'ignored' and ${messageEvents.lastErrorCode} = 'message_window_closed'))::int`,
  }).from(messageEvents).where(scope);
  return counts;
}

export async function legacyInboxOverview(db: Executor, userId: string, automationId: string) {
  const [automation] = await db.select({ id: automations.id, accountId: automations.igAccountId }).from(automations).where(and(eq(automations.id, automationId), eq(automations.userId, userId)));
  if (!automation) return null;
  return messageInboxOverview(db, and(eq(messageEvents.igAccountId, automation.accountId), sql`exists (select 1 from comment_events c where c.id = ${messageEvents.legacyEventId} and c.automation_id = ${automation.id})`)!);
}
