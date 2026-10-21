import { and, eq } from "drizzle-orm";
import type { Db, Executor } from "@/server/db/client";
import { commentEvents, type CommentEvent } from "@/server/db/schema";
import { StaleSendLeaseError } from "@/server/queue/send-errors";

export interface LegacyGuard { event: CommentEvent; active: boolean }

export function legacyLeaseWhere(event: CommentEvent) {
  return and(eq(commentEvents.id, event.id), eq(commentEvents.status, "processing"), eq(commentEvents.sendLeaseVersion, event.sendLeaseVersion));
}

export async function lockLegacyLease(db: Executor, event: CommentEvent) {
  const [current] = await db.select().from(commentEvents).where(legacyLeaseWhere(event)).for("update");
  if (!current) throw new StaleSendLeaseError();
  return current;
}

/** Scope reservation/settlement to the claim epoch. Off-path retains the original pipeline executor. */
export async function withLegacyLease<T>(db: Db, guard: LegacyGuard | undefined, fn: (db: Executor) => Promise<T>): Promise<T> {
  if (!guard?.active) return fn(db);
  return db.transaction(async (tx) => { await lockLegacyLease(tx, guard.event); return fn(tx); });
}
