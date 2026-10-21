import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { and, desc, eq } from "drizzle-orm";
import { LEGACY_HANDOFF_PERMIT_MS, sendJitter } from "@/lib/campaign-rate";
import type { Executor } from "@/server/db/client";
import { campaignNotificationOutbox, commentEvents, followGates, igAccounts, privateReplyClaims, sendAttempts, type CommentEvent, type SendAttempt } from "@/server/db/schema";
import { legacyReadPause, legacySendGuard } from "@/server/campaigns/legacy-guard";
import { acquireSendPermit, databaseNow, observeRateHint, recordSendHealth, releaseSendLease, sendPolicy, type SendPolicy } from "@/server/campaigns/send-budget";
import { invokeBudgetedWrite, type BudgetedWriteResult } from "@/server/campaigns/send-call";
import { classifyError, GraphApiError } from "@/server/instagram/errors";
import type { GraphClient, PrivateReplyMessage } from "@/server/instagram/graph";
import type { GraphRateHint } from "@/server/instagram/rate-hints";
import { backoffDelayMs } from "@/server/queue/backoff";
import { LEGACY_EVENT_LEASE_MS } from "@/server/queue/events";
import { SendDeferredError, SendRejectedError, SendUncertainError, StaleSendLeaseError } from "@/server/queue/send-errors";
import { lockLegacyLease, type LegacyGuard } from "./lease";
import { processCommentEvent, type PipelineDeps, type ProcessOutcome } from "./process-comment";

type Channel = "public_reply" | "private_reply";
type Clock = (db: Executor) => Promise<Date>;
interface AdapterDeps extends PipelineDeps { clock?: Clock }
interface Prepared { attempt: SendAttempt; policy: SendPolicy; clockStarted: number; hardExpiresAt: Date }
type PreparedResult = Prepared | { cached: string } | { error: Error };
type CallResult = BudgetedWriteResult;
const logicalKey = (event: CommentEvent, channel: Channel) => `legacy:${event.id}:${channel}`;

async function acceptedEventPatch(tx: Executor, event: CommentEvent, channel: Channel, id: string) {
  if (channel === "public_reply") await tx.update(commentEvents).set({ replyStatus: "sent", replyCommentId: id }).where(eq(commentEvents.id, event.id));
  else {
    const [gate] = await tx.select({ id: followGates.id, status: followGates.status }).from(followGates).where(eq(followGates.eventId, event.id));
    // An accepted ordinary follow link can precede a slower public reply. Never restore its earlier gate message over it.
    if (gate?.status !== "sent") await tx.update(commentEvents).set({ dmMessageId: id, dmStatus: gate ? null : "sent", dmReservedAt: null }).where(eq(commentEvents.id, event.id));
    await tx.update(privateReplyClaims).set({ state: "sent" }).where(eq(privateReplyClaims.legacyEventId, event.id));
  }
}

/** Repair only local state from durable acceptance; an unresolved write is never re-sent. */
async function reconcile(deps: AdapterDeps, guard: LegacyGuard): Promise<CommentEvent | "send_unknown"> {
  return deps.db.transaction(async (tx) => {
    const event = await lockLegacyLease(tx, guard.event);
    const attempts = await tx.select().from(sendAttempts).where(eq(sendAttempts.legacyEventId, event.id)).orderBy(desc(sendAttempts.attempt));
    if (attempts.some((a) => ["sending", "unknown"].includes(a.state))) {
      await tx.update(sendAttempts).set({ state: "unknown", errorCode: "previous_attempt_unresolved", finishedAt: await (deps.clock ?? databaseNow)(tx), payload: null }).where(and(eq(sendAttempts.legacyEventId, event.id), eq(sendAttempts.state, "sending")));
      if (attempts.some((a) => a.channel === "private_reply" && ["sending", "unknown"].includes(a.state))) await tx.update(privateReplyClaims).set({ state: "unknown" }).where(eq(privateReplyClaims.legacyEventId, event.id));
      await tx.update(commentEvents).set({ status: "send_unknown", lockedAt: null, completedAt: await (deps.clock ?? databaseNow)(tx), errorCode: "previous_attempt_unresolved", errorMessage: "발송 결과 확인이 필요해요. 자동 재발송하지 않아요." }).where(eq(commentEvents.id, event.id));
      return "send_unknown";
    }
    for (const channel of ["public_reply", "private_reply"] as const) {
      const accepted = attempts.find((a) => a.logicalKey === logicalKey(event, channel) && a.state === "accepted" && a.providerMessageId);
      if (accepted) await acceptedEventPatch(tx, event, channel, accepted.providerMessageId!);
    }
    const [updated] = await tx.select().from(commentEvents).where(eq(commentEvents.id, event.id));
    return updated;
  });
}

async function commentDeadline(deps: AdapterDeps, guard: LegacyGuard, policy: SendPolicy): Promise<Date> {
  let event = guard.event;
  if (!event.commentCreatedAt) {
    const now = await (deps.clock ?? databaseNow)(deps.db);
    const pause = await legacyReadPause(deps.db, event.igAccountId, now);
    if (pause) throw new SendDeferredError(pause, "api_cooldown");
    const [account] = await deps.db.select().from(igAccounts).where(eq(igAccounts.id, event.igAccountId));
    if (!account?.accessTokenEnc || account.status !== "active") throw new SendRejectedError("account_inactive", true);
    try {
      const metadata = await deps.graph.getComment(deps.decryptToken(account.accessTokenEnc), event.commentId);
      await observeRateHint(deps.db, event.igAccountId, metadata.rateHint, now);
      if (metadata.id !== event.commentId || metadata.mediaId !== event.mediaId || metadata.authorId !== event.commenterIgId || !metadata.createdAt || metadata.createdAt > now) throw new SendRejectedError("invalid_comment_metadata");
      const createdAt = metadata.createdAt;
      event = await deps.db.transaction(async (tx) => {
        await lockLegacyLease(tx, event);
        const [updated] = await tx.update(commentEvents).set({ commentCreatedAt: createdAt, timestampSource: "graph" }).where(eq(commentEvents.id, event.id)).returning();
        return updated;
      });
      guard.event = event;
    } catch (error) {
      if (error instanceof SendRejectedError || error instanceof StaleSendLeaseError) throw error;
      const failure = classifyError(error);
      if (failure.cls === "auth") {
        await deps.db.transaction(async (tx) => {
          const [changed] = await tx.update(igAccounts).set({ status: "reauth_required" }).where(and(eq(igAccounts.id, event.igAccountId), eq(igAccounts.status, "active"))).returning();
          if (changed) await tx.insert(campaignNotificationOutbox).values({ igAccountId: changed.id, userId: changed.userId, key: `read-auth:${event.id}`, kind: "reauth_required", reason: failure.code, nextAttemptAt: now }).onConflictDoNothing();
        });
        throw new SendRejectedError(failure.code, true);
      }
      if (!["transient", "rate_limited"].includes(failure.cls) || event.attempts >= policy.max_attempts) throw new SendRejectedError(failure.code);
      const retryAfterMs = error instanceof GraphApiError ? error.retryAfterMs : undefined;
      if (retryAfterMs) await observeRateHint(deps.db, event.igAccountId, { retryAfterMs }, now);
      throw new SendDeferredError(new Date(now.getTime() + Math.max(retryAfterMs ?? 0, backoffDelayMs(event.attempts, deps.random))), failure.code, true);
    }
  }
  return new Date(event.commentCreatedAt!.getTime() + 7 * 86_400_000);
}

async function prepare(deps: AdapterDeps, guard: LegacyGuard, channel: Channel, payload: PrivateReplyMessage, policy: SendPolicy, hardExpiresAt: Date): Promise<PreparedResult> {
  return deps.db.transaction(async (tx) => {
    const event = await lockLegacyLease(tx, guard.event); const now = await (deps.clock ?? databaseNow)(tx);
    if (!event.lockedAt || event.lockedAt.getTime() + LEGACY_EVENT_LEASE_MS <= now.getTime()) return { error: new StaleSendLeaseError() };
    const [last] = await tx.select().from(sendAttempts).where(eq(sendAttempts.logicalKey, logicalKey(event, channel))).orderBy(desc(sendAttempts.attempt)).limit(1);
    if (last?.state === "accepted" && last.providerMessageId) return { cached: last.providerMessageId };
    if (last && ["sending", "unknown"].includes(last.state)) return { error: new SendUncertainError("previous_attempt_unresolved") };
    if (hardExpiresAt <= now) return { error: new SendRejectedError("expired") };
    const jitterUntil = event.guardedJitterUntil ?? new Date(now.getTime() + sendJitter(policy.jitter_min_ms, policy.jitter_max_ms, deps.random));
    if (!event.guardedJitterUntil) await tx.update(commentEvents).set({ guardedJitterUntil: jitterUntil }).where(eq(commentEvents.id, event.id));
    if (jitterUntil > now) return { error: new SendDeferredError(jitterUntil, "jitter") };
    if (channel === "private_reply") {
      await tx.insert(privateReplyClaims).values({ commentId: event.commentId, legacyEventId: event.id }).onConflictDoNothing();
      const [claim] = await tx.select().from(privateReplyClaims).where(eq(privateReplyClaims.commentId, event.commentId));
      if (claim.legacyEventId !== event.id || claim.state !== "reserved") return { error: new SendUncertainError("private_reply_claim_unavailable") };
    }
    const clockStarted = performance.now(); const permitAt = await (deps.clock ?? databaseNow)(tx);
    try {
      const permit = await acquireSendPermit(tx, { igAccountId: event.igAccountId, channel, logicalKey: logicalKey(event, channel), leaseOwner: `legacy:${randomUUID()}`, leaseVersion: event.sendLeaseVersion,
        legacyEventId: event.id, payload, now: permitAt,
        // Off->legacy handoff is safe only after the LAST shared write ages out of the rolling hour.
        extendSafety: true }, policy, deps.random);
      return permit.cached ? { cached: permit.providerMessageId } : { attempt: permit.attempt, policy, clockStarted, hardExpiresAt };
    } catch (error) {
      if (error instanceof SendDeferredError || error instanceof SendRejectedError || error instanceof SendUncertainError) return { error };
      throw error;
    }
  });
}

async function settle(deps: AdapterDeps, guard: LegacyGuard, prepared: Prepared, result: CallResult): Promise<Error | null> {
  return deps.db.transaction(async (tx) => {
    const now = await (deps.clock ?? databaseNow)(tx);
    const [event] = await tx.select().from(commentEvents).where(eq(commentEvents.id, guard.event.id)).for("update");
    const [attempt] = await tx.select().from(sendAttempts).where(eq(sendAttempts.id, prepared.attempt.id));
    if (!attempt) return new StaleSendLeaseError();
    if (!event || event.status !== "processing" || event.sendLeaseVersion !== attempt.leaseVersion || !event.lockedAt || event.lockedAt.getTime() + LEGACY_EVENT_LEASE_MS <= now.getTime() || attempt.state !== "sending") {
      if (!attempt.lateResult && result.state === "error" && result.failure.protection) await recordSendHealth(tx, attempt, result.failure, now, prepared.policy);
      await tx.update(sendAttempts).set({ lateResult: result.state === "accepted" ? { state: "accepted", providerMessageId: result.providerMessageId } : { state: result.state } }).where(eq(sendAttempts.id, attempt.id));
      return new StaleSendLeaseError();
    }
    if (result.state === "not_invoked") {
      await tx.update(sendAttempts).set({ state: "not_invoked", finishedAt: now, payload: null }).where(eq(sendAttempts.id, attempt.id));
      await releaseSendLease(tx, event.igAccountId, attempt.channel, attempt.leaseOwner);
      return new SendDeferredError(new Date(now.getTime() + 1000), "permit_elapsed");
    }
    if (result.state === "accepted") {
      await tx.update(sendAttempts).set({ state: "accepted", providerMessageId: result.providerMessageId, invokedAt: result.invokedAt, finishedAt: now, payload: null }).where(eq(sendAttempts.id, attempt.id));
      await acceptedEventPatch(tx, event, attempt.channel as Channel, result.providerMessageId);
      await observeRateHint(tx, event.igAccountId, result.rateHint, now);
      await recordSendHealth(tx, attempt, null, now, prepared.policy);
      return null;
    }
    const failure = result.failure;
    await tx.update(sendAttempts).set({ state: failure.state === "unknown" ? "unknown" : "rejected", errorCode: failure.code, invokedAt: result.invokedAt, finishedAt: now, payload: null }).where(eq(sendAttempts.id, attempt.id));
    await recordSendHealth(tx, attempt, failure, now, prepared.policy);
    if (failure.retryAfterMs) await observeRateHint(tx, event.igAccountId, { retryAfterMs: failure.retryAfterMs }, now);
    await releaseSendLease(tx, event.igAccountId, attempt.channel, attempt.leaseOwner);
    if (failure.state === "unknown") {
      if (attempt.channel === "private_reply") await tx.update(privateReplyClaims).set({ state: "unknown" }).where(eq(privateReplyClaims.legacyEventId, event.id));
      return new SendUncertainError(failure.code);
    }
    if (failure.state === "failed" && failure.code === "100/2534015" && prepared.attempt.payload?.kind !== "text") {
      await tx.update(igAccounts).set({ dmFormat: "text" }).where(eq(igAccounts.id, event.igAccountId));
      return new SendDeferredError(new Date(now.getTime() + 1000), "text_format_retry");
    }
    if (failure.state === "retry") return new SendDeferredError(new Date(now.getTime() + Math.max(failure.retryAfterMs ?? 0, backoffDelayMs(attempt.attempt, deps.random))), failure.code);
    return new SendRejectedError(failure.code, failure.protection === "auth");
  });
}

export function guardedLegacyGraph(deps: AdapterDeps, guard: LegacyGuard): GraphClient {
  async function send(channel: Channel, payload: PrivateReplyMessage, invoke: () => Promise<{ id: string; rateHint?: GraphRateHint }>): Promise<{ id: string; rateHint?: GraphRateHint }> {
    for (;;) {
      const checkedAt = performance.now();
      const now = await (deps.clock ?? databaseNow)(deps.db);
      const decision = await legacySendGuard(deps.db, guard.event.igAccountId, now, { ignoreCurrentEventId: guard.active ? guard.event.id : undefined, force: guard.active });
      if (decision.guarded) break;
      if (performance.now() - checkedAt < LEGACY_HANDOFF_PERMIT_MS) return invoke();
    }
    guard.active = true;
    const policy = await sendPolicy(deps.db);
    const deadline = channel === "private_reply" ? await commentDeadline(deps, guard, policy) : new Date(guard.event.receivedAt.getTime() + 7 * 86_400_000);
    const prepared = await prepare(deps, guard, channel, payload, policy, deadline);
    if ("error" in prepared) throw prepared.error;
    if ("cached" in prepared) return { id: prepared.cached };
    const result = await invokeBudgetedWrite({ startedAt: prepared.attempt.startedAt, monotonicStartedAt: prepared.clockStarted, validForMs: policy.send_permit_ms, deadlineAt: prepared.hardExpiresAt }, invoke);
    let error: Error | null;
    try { error = await settle(deps, guard, prepared, result); }
    catch { throw new SendUncertainError("send_result_commit_failed"); }
    if (error) throw error;
    if (result.state !== "accepted") throw new SendUncertainError("unexpected_send_result");
    return { id: result.providerMessageId, rateHint: result.rateHint };
  }
  const overrides: Pick<GraphClient, "replyToComment" | "sendPrivateReply"> = {
    replyToComment: (token, commentId, text) => send("public_reply", { kind: "text", text }, () => deps.graph.replyToComment(token, commentId, text)),
    sendPrivateReply: async (token, accountId, commentId, message) => {
      const result = await send("private_reply", message, async () => { const response = await deps.graph.sendPrivateReply(token, accountId, commentId, message); return { id: response.messageId, rateHint: response.rateHint }; });
      return { messageId: result.id, ...(result.rateHint ? { rateHint: result.rateHint } : {}) };
    },
  };
  return new Proxy(deps.graph, { get(target, key) { if (key in overrides) return overrides[key as keyof typeof overrides]; const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; } });
}

/** Existing keyword/plan/dedupe behavior stays in processCommentEvent; only enabled or residual sends share the new budget. */
export async function processWithSharedBudget(deps: AdapterDeps, event: CommentEvent): Promise<ProcessOutcome> {
  const now = await (deps.clock ?? databaseNow)(deps.db);
  const decision = await legacySendGuard(deps.db, event.igAccountId, now, { ignoreCurrentEventId: event.dmReservedAt ? undefined : event.id, force: event.guardedJitterUntil !== null });
  const guard: LegacyGuard = { event, active: decision.guarded };
  if (guard.active) {
    try {
      const restored = await reconcile(deps, guard);
      if (restored === "send_unknown") return restored;
      guard.event = restored;
    } catch (error) { if (error instanceof StaleSendLeaseError) return "stale"; throw error; }
  }
  return processCommentEvent({ ...deps, guard, graph: guardedLegacyGraph(deps, guard), onAuthFailure: async (account) => { if (!guard.active) await deps.onAuthFailure?.(account); } }, guard.event);
}
