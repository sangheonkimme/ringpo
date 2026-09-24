import { eq, inArray, or } from "drizzle-orm";
import { randomToken } from "@/server/crypto";
import type { Db, Executor } from "@/server/db/client";
import { automations, dataDeletionRequests, igAccounts } from "@/server/db/schema";

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
  if (ids.length > 0) await db.delete(igAccounts).where(inArray(igAccounts.id, ids));
  await db
    .update(dataDeletionRequests)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(dataDeletionRequests.confirmationCode, confirmationCode));
  return { url: `${appUrl}/data-deletion/${confirmationCode}`, confirmationCode };
}
