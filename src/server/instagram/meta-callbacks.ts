import { eq, inArray, or } from "drizzle-orm";
import { randomToken } from "@/server/crypto";
import type { Db, Executor } from "@/server/db/client";
import { automations, commentEvents, dataDeletionRequests, igAccounts, links } from "@/server/db/schema";

async function findAccountIds(db: Executor, metaUserId: string): Promise<string[]> {
  const rows = await db
    .select({ id: igAccounts.id })
    .from(igAccounts)
    .where(or(eq(igAccounts.igScopedId, metaUserId), eq(igAccounts.igUserId, metaUserId)));
  return rows.map((r) => r.id);
}

export async function disconnectIgAccounts(db: Executor, accountIds: string[]): Promise<void> {
  if (accountIds.length === 0) return;
  await db
    .update(igAccounts)
    .set({ status: "disconnected", accessTokenEnc: null, tokenExpiresAt: null })
    .where(inArray(igAccounts.id, accountIds));
  await db.update(automations).set({ isActive: false }).where(inArray(automations.igAccountId, accountIds));
}

/** 계정과 그 자동화·이벤트·단축 링크를 지운다. links는 FK가 SET NULL이라 계정 삭제만으로는 남으므로 먼저 지운다 */
export async function deleteIgAccounts(db: Executor, accountIds: string[]): Promise<void> {
  if (accountIds.length === 0) return;
  const autoIds = db.select({ id: automations.id }).from(automations).where(inArray(automations.igAccountId, accountIds));
  const eventIds = db.select({ id: commentEvents.id }).from(commentEvents).where(inArray(commentEvents.igAccountId, accountIds));
  await db.delete(links).where(or(inArray(links.automationId, autoIds), inArray(links.eventId, eventIds)));
  await db.delete(igAccounts).where(inArray(igAccounts.id, accountIds));
}

export async function handleDeauthorize(db: Db, metaUserId: string): Promise<number> {
  const ids = await findAccountIds(db, metaUserId);
  await disconnectIgAccounts(db, ids);
  return ids.length;
}

export async function handleDataDeletion(
  db: Db,
  metaUserId: string,
  appUrl: string,
): Promise<{ url: string; confirmationCode: string }> {
  const confirmationCode = randomToken(12);
  await db.insert(dataDeletionRequests).values({ confirmationCode, igUserId: metaUserId });
  const ids = await findAccountIds(db, metaUserId);
  await deleteIgAccounts(db, ids);
  await db
    .update(dataDeletionRequests)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(dataDeletionRequests.confirmationCode, confirmationCode));
  return { url: `${appUrl}/data-deletion/${confirmationCode}`, confirmationCode };
}
