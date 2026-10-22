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
  return db.transaction(async (tx) => {
    const stale = await tx
      .select({ id: commentEvents.id, usagePeriod: commentEvents.usagePeriod, dmStatus: commentEvents.dmStatus, dmMessageId: commentEvents.dmMessageId, guardedJitterUntil: commentEvents.guardedJitterUntil, replyStatus: commentEvents.replyStatus, userId: igAccounts.userId })
      .from(commentEvents)
      .innerJoin(igAccounts, eq(igAccounts.id, commentEvents.igAccountId))
      .where(and(eq(commentEvents.status, "pending"), lt(commentEvents.receivedAt, new Date(now.getTime() - 7 * DAY))))
      .limit(500).for("update", { of: commentEvents, skipLocked: true });
    for (const ev of stale) {
      if (ev.guardedJitterUntil && ev.dmMessageId && ev.dmStatus === null) {
        await finishEvent(tx, ev.id, "awaiting_follow", { replyStatus: ev.replyStatus ?? "failed" }, now);
        continue;
      }
      // DM이 이미 나갔으면 예약을 유지하고 일부 발송으로 끝낸다
      if (ev.dmStatus === "sent") {
        await finishEvent(tx, ev.id, "partial", { replyStatus: ev.replyStatus ?? "failed" }, now);
        continue;
      }
      await releaseDelivery(tx, ev.id);
      if (ev.usagePeriod) await releaseDm(tx, ev.userId, ev.usagePeriod);
      await finishEvent(tx, ev.id, "expired", { errorCode: "expired", usagePeriod: null }, now);
    }
    return stale.length;
  });
}

export async function cleanupOldData(db: Db, now: Date): Promise<void> {
  // Campaign and guarded delivery facts are report/deduplication evidence. Their content has its own TTL.
  const unguardedLegacy = sql`comment_events.route_owner = 'legacy' and comment_events.campaign_id is null
    and comment_events.flag_checked_at is null and comment_events.guarded_jitter_until is null
    and not exists (select 1 from dm_jobs j where j.source_event_id = comment_events.id)
    and not exists (select 1 from send_attempts a where a.legacy_event_id = comment_events.id)
    and not exists (select 1 from message_events m where m.legacy_event_id = comment_events.id)`;
  await db
    .delete(commentEvents)
    .where(
      and(
        eq(commentEvents.status, "skipped"),
        unguardedLegacy,
        inArray(commentEvents.skipReason, ["no_match", "self"]),
        lt(commentEvents.createdAt, new Date(now.getTime() - 3 * DAY)),
      ),
    );
  await db
    .delete(commentEvents)
    .where(
      and(
        inArray(commentEvents.status, ["succeeded", "partial", "failed", "skipped", "expired"]),
        unguardedLegacy,
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
