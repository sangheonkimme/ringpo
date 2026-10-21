import { and, asc, eq, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import type { Db, Executor } from "@/server/db/client";
import { commentEvents, conversationStates, followGates, igAccounts, messageEvents, type MessageEvent } from "@/server/db/schema";
import type { ParsedCampaignMessage } from "@/server/instagram/campaign-messaging";
import { legacySendGuard } from "./legacy-guard";
import { sendPolicy } from "./send-budget";

export const MESSAGE_QUEUE_CHANNEL = "gonggu_message_events";

/** No Meta request or external send runs in the webhook. OFF accounts keep the original tap handler. */
export async function ingestGuardedMessages(db: Db, messages: ParsedCampaignMessage[], now: Date) {
  const guardedIgUserIds = new Set<string>();
  if (!messages.length) return { queued: 0, guardedIgUserIds };
  const accounts = await db.select().from(igAccounts).where(and(inArray(igAccounts.igUserId, [...new Set(messages.map((m) => m.igUserId))]), eq(igAccounts.status, "active")));
  let queued = 0;
  for (const account of accounts) {
    const peers = [...new Set(messages.filter((m) => m.igUserId === account.igUserId).map((m) => m.peerId))];
    const [unfinishedGate] = await db.select({ id: followGates.id }).from(followGates).innerJoin(commentEvents, eq(commentEvents.id, followGates.eventId))
      .where(and(eq(followGates.igAccountId, account.id), eq(followGates.status, "waiting"), inArray(commentEvents.commenterIgId, peers), isNotNull(commentEvents.guardedJitterUntil), or(isNotNull(commentEvents.dmMessageId), eq(commentEvents.status, "send_unknown")))).limit(1);
    const [unfinishedMessage] = await db.select({ id: messageEvents.id }).from(messageEvents).where(and(eq(messageEvents.igAccountId, account.id), inArray(messageEvents.peerId, peers), inArray(messageEvents.status, ["pending", "leased"]))).limit(1);
    // A reply to a guarded request can arrive days later, after the ordinary OFF safety hour has elapsed.
    if (!(await legacySendGuard(db, account.id, now, { force: Boolean(unfinishedGate || unfinishedMessage) })).guarded) continue;
    guardedIgUserIds.add(account.igUserId);
    for (const message of messages.filter((m) => m.igUserId === account.igUserId)) {
      queued += await db.transaction(async (tx) => {
        // Serialize a conversation's arrivals, including delete-before-message races.
        await tx.insert(conversationStates).values({ igAccountId: account.id, senderId: message.peerId }).onConflictDoNothing();
        await tx.select({ id: conversationStates.senderId }).from(conversationStates).where(and(eq(conversationStates.igAccountId, account.id), eq(conversationStates.senderId, message.peerId))).for("update");
        const validTime = message.occurredAt !== null && message.occurredAt <= now;
        const evidence = validTime && message.userMessageEvidence;
        const [tombstone] = message.providerMessageId ? await tx.select({ id: messageEvents.id }).from(messageEvents).where(and(eq(messageEvents.igAccountId, account.id), eq(messageEvents.peerId, message.peerId), eq(messageEvents.kind, "deleted"), eq(messageEvents.providerMessageId, message.providerMessageId))).limit(1) : [];
        const [row] = await tx.insert(messageEvents).values({
          igAccountId: account.id, peerId: message.peerId, eventKey: message.eventKey, providerMessageId: message.providerMessageId,
          kind: message.kind, occurredAt: message.occurredAt, receivedAt: now, userMessageEvidence: evidence,
          text: tombstone ? "" : message.text, payload: tombstone ? null : message.payload, replyToMessageId: message.replyToMessageId,
          deletedAt: tombstone ? now : null, nextAttemptAt: now,
          status: validTime && !tombstone ? "pending" : "ignored", lastErrorCode: tombstone ? "message_deleted" : validTime ? null : "invalid_message_time",
          completedAt: validTime && !tombstone ? null : now,
        }).onConflictDoNothing({ target: [messageEvents.igAccountId, messageEvents.eventKey] }).returning();
        if (!row) return 0;
        if (message.kind === "deleted" && message.providerMessageId) {
          await tx.update(messageEvents).set({ text: "", payload: null, deletedAt: now }).where(and(eq(messageEvents.igAccountId, account.id), eq(messageEvents.peerId, message.peerId), eq(messageEvents.providerMessageId, message.providerMessageId)));
        }
        if (evidence && !tombstone) {
          // Delivery order and duplicate webhooks must never move the window backwards or extend it to receipt time.
          await tx.insert(conversationStates).values({ igAccountId: account.id, senderId: message.peerId, consentAt: message.occurredAt, lastUserInteractionAt: message.occurredAt, lastUserEventId: row.id })
            .onConflictDoUpdate({ target: [conversationStates.igAccountId, conversationStates.senderId], set: {
              consentAt: sql`least(${conversationStates.consentAt}, excluded.consent_at)`,
              lastUserInteractionAt: sql`greatest(${conversationStates.lastUserInteractionAt}, excluded.last_user_interaction_at)`,
              lastUserEventId: sql`case when ${conversationStates.lastUserInteractionAt} is null or excluded.last_user_interaction_at > ${conversationStates.lastUserInteractionAt} then excluded.last_user_event_id else ${conversationStates.lastUserEventId} end`,
            } });
        }
        if (row.status === "pending") await tx.execute(sql`select pg_notify(${MESSAGE_QUEUE_CHANNEL}, '')`);
        return row.status === "pending" ? 1 : 0;
      });
    }
  }
  return { queued, guardedIgUserIds };
}

export function messageLeaseFence(message: MessageEvent) {
  return and(eq(messageEvents.id, message.id), eq(messageEvents.leaseVersion, message.leaseVersion), eq(messageEvents.status, "leased"));
}

export async function claimMessageEvents(db: Db, options: { batch: number; now: Date }): Promise<MessageEvent[]> {
  if (options.batch <= 0) return [];
  const policy = await sendPolicy(db);
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(messageEvents).where(and(eq(messageEvents.status, "pending"), lte(messageEvents.nextAttemptAt, options.now)))
      .orderBy(asc(messageEvents.nextAttemptAt), asc(messageEvents.id)).limit(options.batch).for("update", { skipLocked: true });
    if (!rows.length) return [];
    return tx.update(messageEvents).set({ status: "leased", leaseUntil: new Date(options.now.getTime() + policy.dispatch_lease_seconds * 1000), leaseVersion: sql`${messageEvents.leaseVersion} + 1`, attempts: sql`${messageEvents.attempts} + 1` })
      .where(inArray(messageEvents.id, rows.map((row) => row.id))).returning();
  });
}

/** Inbox handlers only read Meta and atomically create durable send jobs; a lost lease is safe to route again. */
export async function recoverMessageEvents(db: Db, now: Date) {
  const rows = await db.update(messageEvents).set({ status: "pending", leaseUntil: null, nextAttemptAt: now, lastErrorCode: "recovered_lease" })
    .where(and(eq(messageEvents.status, "leased"), isNotNull(messageEvents.leaseUntil), lte(messageEvents.leaseUntil, now))).returning({ id: messageEvents.id });
  return rows.length;
}

export async function expireMessageEvents(db: Db, now: Date) {
  const policy = await sendPolicy(db);
  const rows = await db.update(messageEvents).set({ status: "ignored", completedAt: now, lastErrorCode: "message_window_closed" }).where(and(
    eq(messageEvents.status, "pending"), inArray(messageEvents.kind, ["message", "postback"]),
    lte(messageEvents.occurredAt, new Date(now.getTime() - (policy.message_window_seconds - policy.message_safety_seconds) * 1000)),
  )).returning({ id: messageEvents.id });
  return rows.length;
}

export async function finishMessageEvent(db: Executor, message: MessageEvent, now: Date, status: "routed" | "ignored" | "failed", code: string | null, campaignId?: string) {
  await db.update(messageEvents).set({ status, lastErrorCode: code, leaseUntil: null, completedAt: now, ...(campaignId ? { campaignId } : {}) }).where(messageLeaseFence(message));
}

export async function deferMessageEvent(db: Executor, message: MessageEvent, until: Date, code: string, refundAttempt = false) {
  await db.update(messageEvents).set({ status: "pending", nextAttemptAt: until, leaseUntil: null, lastErrorCode: code,
    ...(refundAttempt ? { attempts: sql`greatest(0, ${messageEvents.attempts} - 1)` } : {}),
  }).where(messageLeaseFence(message));
}
