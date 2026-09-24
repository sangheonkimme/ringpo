import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { commentEvents, igAccounts, mediaCache, workerHeartbeats, type IgAccount } from "@/server/db/schema";
import { classifyError } from "@/server/instagram/errors";
import type { GraphClient } from "@/server/instagram/graph";
import { log } from "@/server/log";
import { releaseDelivery } from "@/server/pipeline/deliveries";
import { finishEvent } from "@/server/queue/events";
import { releaseDm } from "@/server/usage";

const DAY = 86_400_000;

export async function withJobLock(db: Db, name: string, fn: () => Promise<void>): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext(${`job:${name}`})) as locked`,
    );
    if (!rows[0]?.locked) return false;
    await fn();
    return true;
  });
}

export async function refreshExpiringTokens(deps: {
  db: Db;
  graph: GraphClient;
  now: () => Date;
  encrypt: (s: string) => string;
  decrypt: (s: string) => string;
  onReauthRequired?: (account: IgAccount) => Promise<void>;
}): Promise<{ refreshed: number; flagged: number }> {
  const { db } = deps;
  const now = deps.now();
  const due = await db
    .select()
    .from(igAccounts)
    .where(
      and(
        eq(igAccounts.status, "active"),
        isNotNull(igAccounts.accessTokenEnc),
        lt(igAccounts.tokenExpiresAt, new Date(now.getTime() + 7 * DAY)),
      ),
    )
    .limit(200);

  let refreshed = 0;
  let flagged = 0;
  const flag = async (account: IgAccount) => {
    await db.update(igAccounts).set({ status: "reauth_required" }).where(eq(igAccounts.id, account.id));
    flagged++;
    await deps.onReauthRequired?.(account);
  };

  for (const account of due) {
    if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= now.getTime()) {
      await flag(account);
      continue;
    }
    try {
      const res = await deps.graph.refreshToken(deps.decrypt(account.accessTokenEnc ?? ""));
      await db
        .update(igAccounts)
        .set({
          accessTokenEnc: deps.encrypt(res.accessToken),
          tokenExpiresAt: new Date(now.getTime() + res.expiresIn * 1000),
        })
        .where(eq(igAccounts.id, account.id));
      refreshed++;
    } catch (e) {
      const c = classifyError(e);
      if (c.cls === "auth" || c.cls === "permanent") await flag(account);
      else log.warn("token refresh deferred", { igAccountId: account.id, code: c.code });
    }
  }
  return { refreshed, flagged };
}

export async function expireStaleEvents(db: Db, now: Date): Promise<number> {
  const stale = await db
    .select({ id: commentEvents.id, usagePeriod: commentEvents.usagePeriod, userId: igAccounts.userId })
    .from(commentEvents)
    .innerJoin(igAccounts, eq(igAccounts.id, commentEvents.igAccountId))
    .where(and(eq(commentEvents.status, "pending"), lt(commentEvents.receivedAt, new Date(now.getTime() - 7 * DAY))))
    .limit(500);
  for (const ev of stale) {
    await releaseDelivery(db, ev.id);
    if (ev.usagePeriod) await releaseDm(db, ev.userId, ev.usagePeriod);
    await finishEvent(db, ev.id, "expired", { errorCode: "expired", usagePeriod: null }, now);
  }
  return stale.length;
}

export async function cleanupOldData(db: Db, now: Date): Promise<void> {
  await db
    .delete(commentEvents)
    .where(
      and(
        eq(commentEvents.status, "skipped"),
        inArray(commentEvents.skipReason, ["no_match", "self"]),
        lt(commentEvents.createdAt, new Date(now.getTime() - 3 * DAY)),
      ),
    );
  await db
    .delete(commentEvents)
    .where(
      and(
        inArray(commentEvents.status, ["succeeded", "partial", "failed", "skipped", "expired"]),
        lt(commentEvents.createdAt, new Date(now.getTime() - 180 * DAY)),
      ),
    );
  await db.delete(mediaCache).where(lt(mediaCache.fetchedAt, new Date(now.getTime() - 30 * DAY)));
  await db.delete(workerHeartbeats).where(lt(workerHeartbeats.beatAt, new Date(now.getTime() - DAY)));
}

export async function beat(db: Db, workerId: string, now: Date): Promise<void> {
  await db
    .insert(workerHeartbeats)
    .values({ workerId, beatAt: now })
    .onConflictDoUpdate({ target: workerHeartbeats.workerId, set: { beatAt: now } });
}
