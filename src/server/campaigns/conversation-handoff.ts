import { and, eq, inArray, sql } from "drizzle-orm";
import { commentEvents, conversationStates, dmJobs, messageEvents, sendAttempts, type MessageEvent } from "@/server/db/schema";
import type { MessageRouterDeps } from "./follow-messages";
import { campaignPolicy } from "./access";
import { faqHandoffReady } from "./faq-access";
import { deferMessageEvent, finishMessageEvent, messageLeaseFence } from "./message-inbox";

/** Echoes are held at ingress. Correlate our own writes before treating an outbound message as human. */
export async function routeConversationEcho(deps: MessageRouterDeps, source: MessageEvent): Promise<string | null> {
  if (source.kind !== "echo") return null;
  const { db } = deps;
  return db.transaction(async (tx) => {
    const where = and(eq(conversationStates.igAccountId, source.igAccountId), eq(conversationStates.senderId, source.peerId));
    const [conversation] = await tx.select().from(conversationStates).where(where).for("update");
    const [message] = await tx.select().from(messageEvents).where(messageLeaseFence(source)).for("update");
    const now = deps.now();
    if (!message || !message.leaseUntil || message.leaseUntil <= now) return "stale_lease";
    const finish = async (code: string) => {
      await finishMessageEvent(tx, message, now, "ignored", code);
      // Multiple out-of-order echoes must all be reviewed before the conversation can send again.
      const [next] = await tx.select({ id: messageEvents.id }).from(messageEvents).where(and(eq(messageEvents.igAccountId, source.igAccountId), eq(messageEvents.peerId, source.peerId), eq(messageEvents.kind, "echo"), inArray(messageEvents.status, ["pending", "leased"]))).limit(1);
      await tx.update(conversationStates).set({ pendingEchoEventId: next?.id ?? null, updatedAt: now }).where(where);
      return code;
    };
    if (!conversation || !message.occurredAt || message.occurredAt > now || !await faqHandoffReady(tx, message.igAccountId)) return finish("echo_unverified");
    const id = message.providerMessageId;
    const [own] = await tx.execute<{ known: boolean }>(sql`select (
      exists (select 1 from ${sendAttempts} a where a.ig_account_id = ${message.igAccountId} and (a.provider_message_id = ${id} or (a.late_result->>'state' = 'accepted' and a.late_result->>'providerMessageId' = ${id})))
      or exists (select 1 from ${dmJobs} j where j.ig_account_id = ${message.igAccountId} and j.provider_message_id = ${id})
      or exists (select 1 from ${commentEvents} c where c.ig_account_id = ${message.igAccountId} and c.dm_message_id = ${id})
    ) as known`);
    if (own?.known) return finish("ringpo_echo");
    // Meta may deliver an echo before our HTTP response is committed. Keep it blocked while that write resolves.
    const [inflight] = await tx.execute<{ active: boolean }>(sql`select exists (
      select 1 from send_attempts a left join dm_jobs j on j.id = a.job_id left join campaign_participants p on p.id = j.participant_id
      left join comment_events c on c.id = a.legacy_event_id
      where a.ig_account_id = ${message.igAccountId} and a.channel <> 'public_reply' and a.state = 'sending'
        and (p.commenter_ig_id = ${message.peerId} or c.commenter_ig_id = ${message.peerId})
    ) as active`);
    if (inflight?.active && now.getTime() - message.receivedAt.getTime() < 120_000) {
      await deferMessageEvent(tx, message, new Date(now.getTime() + 5000), "echo_send_pending", true); return "echo_send_pending";
    }
    const until = new Date(message.occurredAt.getTime() + await campaignPolicy(tx, "faq_handoff_seconds") * 1000);
    await tx.update(conversationStates).set({ lastHumanAt: sql`greatest(${conversationStates.lastHumanAt}, ${message.occurredAt.toISOString()}::timestamptz)`,
      automationPausedUntil: sql`greatest(${conversationStates.automationPausedUntil}, ${until.toISOString()}::timestamptz)`, updatedAt: now }).where(where);
    return finish("human_handoff");
  });
}
