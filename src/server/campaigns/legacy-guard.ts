import { and, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import type { Db, Executor } from "@/server/db/client";
import { accountSendControls, commentEvents, sendAttempts, sendBuckets } from "@/server/db/schema";
import { campaignsEnabled } from "./access";
import { ensureSendControls, sendPolicy } from "./send-budget";

/** Observe flag transitions at every legacy write, including a flag change during old inline jitter. */
async function hasUntrackedCalls(db: Executor, accountId: string, now: Date, ignoreCurrentEventId?: string) {
  const [row] = await db.select({ id: commentEvents.id }).from(commentEvents)
    .leftJoin(sendAttempts, and(eq(sendAttempts.legacyEventId, commentEvents.id), ne(sendAttempts.state, "not_invoked")))
    .where(and(eq(commentEvents.igAccountId, accountId), eq(commentEvents.routeOwner, "legacy"), isNull(sendAttempts.id),
      ignoreCurrentEventId ? ne(commentEvents.id, ignoreCurrentEventId) : undefined,
      or(gt(commentEvents.dmReservedAt, new Date(now.getTime() - 3_600_000)), eq(commentEvents.status, "processing")))).limit(1);
  return Boolean(row);
}

export async function legacySendGuard(db: Db, accountId: string, now: Date, options: { ignoreCurrentEventId?: string; force?: boolean } = {}): Promise<{ guarded: boolean; enabled: boolean }> {
  return db.transaction(async (tx) => {
    const enabled = await campaignsEnabled(tx, accountId);
    let [control] = await tx.select().from(accountSendControls).where(eq(accountSendControls.igAccountId, accountId)).for("update");
    if (!enabled) {
      if (!control) return { guarded: false, enabled: false };
      if (control.lastObservedEnabled) await tx.update(accountSendControls).set({ lastObservedEnabled: false }).where(eq(accountSendControls.igAccountId, accountId));
      const [protectedChannel] = await tx.select({ channel: sendBuckets.channel }).from(sendBuckets).where(and(eq(sendBuckets.igAccountId, accountId), or(eq(sendBuckets.requiresReview, true), gt(sendBuckets.pausedUntil, now), gt(sendBuckets.leaseUntil, now)))).limit(1);
      const protectedNow = control.manualPaused || Boolean(protectedChannel) || [control.safetyUntil, control.warmupUntil, control.apiPausedUntil].some((until) => until !== null && until > now);
      if (!protectedNow && options.force) {
        const policy = await sendPolicy(tx);
        const warmupUntil = await hasUntrackedCalls(tx, accountId, now, options.ignoreCurrentEventId) ? new Date(now.getTime() + 3_600_000 + policy.send_permit_ms) : null;
        await tx.update(accountSendControls).set({ warmupUntil, safetyUntil: new Date((warmupUntil ?? now).getTime() + 3_600_000 + policy.send_permit_ms) }).where(eq(accountSendControls.igAccountId, accountId));
      }
      return { guarded: protectedNow || Boolean(options.force), enabled: false };
    }
    const policy = await sendPolicy(tx);
    if (!control) {
      control = await ensureSendControls(tx, accountId, now, policy, { ignoreLegacyEventId: options.ignoreCurrentEventId });
    } else if (!control.lastObservedEnabled) {
      // Only the old, unguarded path writes dm_reserved_at. Its recent calls must not disappear on reactivation.
      const untracked = await hasUntrackedCalls(tx, accountId, now, options.ignoreCurrentEventId);
      if (untracked) await tx.update(accountSendControls).set({ warmupUntil: new Date(now.getTime() + 3_600_000 + policy.send_permit_ms) }).where(eq(accountSendControls.igAccountId, accountId));
    }
    await tx.update(accountSendControls).set({ lastObservedEnabled: true }).where(eq(accountSendControls.igAccountId, accountId));
    return { guarded: true, enabled: true };
  });
}

/** Reads also honor an account-wide API cooldown. The caller persists a durable retry time. */
export async function legacyReadPause(db: Db, accountId: string, now: Date): Promise<Date | null> {
  const [row] = await db.select({ until: accountSendControls.apiPausedUntil }).from(accountSendControls).where(and(eq(accountSendControls.igAccountId, accountId), sql`${accountSendControls.apiPausedUntil} > ${now.toISOString()}::timestamptz`));
  return row?.until ?? null;
}
