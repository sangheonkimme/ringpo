import { and, eq } from "drizzle-orm";
import type { BillingGateway } from "@/server/billing/gateway";
import type { Db } from "@/server/db/client";
import { igAccounts, subscriptions, user } from "@/server/db/schema";
import { deleteIgAccounts, disconnectIgAccounts } from "@/server/instagram/meta-callbacks";
import { errorFields, log } from "@/server/log";

export async function disconnectAccount(db: Db, userId: string, accountId: string): Promise<boolean> {
  const [acct] = await db
    .select({ id: igAccounts.id })
    .from(igAccounts)
    .where(and(eq(igAccounts.id, accountId), eq(igAccounts.userId, userId)))
    .limit(1);
  if (!acct) return false;
  await disconnectIgAccounts(db, [acct.id]);
  return true;
}

export async function deleteUserAccount(
  deps: { db: Db; gateway: BillingGateway | null; decrypt: (s: string) => string },
  userId: string,
): Promise<void> {
  const [sub] = await deps.db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  if (sub?.billingKeyEnc && deps.gateway) {
    try {
      await deps.gateway.deleteBillingKey(deps.decrypt(sub.billingKeyEnc));
    } catch (e) {
      log.error("billing key deletion failed during account deletion", errorFields(e));
    }
  }
  const accounts = await deps.db.select({ id: igAccounts.id }).from(igAccounts).where(eq(igAccounts.userId, userId));
  await deleteIgAccounts(deps.db, accounts.map((a) => a.id));
  // payments.user_id / subscription_id 는 ON DELETE SET NULL 이라 결제 기록은 남는다.
  await deps.db.delete(user).where(eq(user.id, userId));
}
