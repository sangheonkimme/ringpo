import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { Db, Executor } from "@/server/db/client";
import { commentEvents, type CommentEvent, type EventStatus, type NewCommentEvent } from "@/server/db/schema";

export const QUEUE_CHANNEL = "comment_events";
const STALE_LOCK_MS = 5 * 60_000;

export type EventPatch = Partial<Omit<NewCommentEvent, "id" | "commentId" | "igAccountId">>;

export async function enqueueComments(db: Executor, rows: NewCommentEvent[]): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(commentEvents)
    .values(rows)
    .onConflictDoNothing({ target: commentEvents.commentId })
    .returning({ id: commentEvents.id });
  if (inserted.length > 0) await db.execute(sql`select pg_notify(${QUEUE_CHANNEL}, '')`);
  return inserted.length;
}

export async function claimEvents(db: Db, o: { batch: number; now: Date }): Promise<CommentEvent[]> {
  if (o.batch <= 0) return [];
  return db.transaction(async (tx) => {
    const staleBefore = new Date(o.now.getTime() - STALE_LOCK_MS);
    const candidates = await tx
      .select({ id: commentEvents.id })
      .from(commentEvents)
      .where(
        or(
          and(eq(commentEvents.status, "pending"), lte(commentEvents.runAt, o.now)),
          and(eq(commentEvents.status, "processing"), lt(commentEvents.lockedAt, staleBefore)),
        ),
      )
      .orderBy(asc(commentEvents.runAt))
      .limit(o.batch)
      .for("update", { skipLocked: true });
    if (candidates.length === 0) return [];
    return tx
      .update(commentEvents)
      .set({ status: "processing", lockedAt: o.now, attempts: sql`${commentEvents.attempts} + 1` })
      .where(
        inArray(
          commentEvents.id,
          candidates.map((c) => c.id),
        ),
      )
      .returning();
  });
}

export async function updateEvent(db: Executor, id: string, patch: EventPatch): Promise<void> {
  await db.update(commentEvents).set(patch).where(eq(commentEvents.id, id));
}

export async function requeueEvent(
  db: Executor,
  id: string,
  runAt: Date,
  patch: EventPatch = {},
  opts: { refundAttempt?: boolean } = {},
): Promise<void> {
  await db
    .update(commentEvents)
    .set({
      ...patch,
      status: "pending",
      runAt,
      lockedAt: null,
      ...(opts.refundAttempt ? { attempts: sql`greatest(${commentEvents.attempts} - 1, 0)` } : {}),
    })
    .where(eq(commentEvents.id, id));
}

export async function finishEvent(
  db: Executor,
  id: string,
  status: Exclude<EventStatus, "pending" | "processing">,
  patch: EventPatch = {},
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(commentEvents)
    .set({ ...patch, status, lockedAt: null, completedAt: now })
    .where(eq(commentEvents.id, id));
}
