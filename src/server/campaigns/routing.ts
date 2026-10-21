import { createHmac, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { privateReplyDeadline } from "@/lib/campaign-jobs";
import type { Db, Executor } from "@/server/db/client";
import { campaigns, campaignParticipants, campaignDeliveries, campaignNotificationOutbox, commentEvents, dmJobs, igAccounts, privateReplyClaims, type CommentEvent, type NewCommentEvent } from "@/server/db/schema";
import { classifyError, GraphApiError } from "@/server/instagram/errors";
import type { GraphClient } from "@/server/instagram/graph";
import { CAMPAIGN_FLAG, CampaignError, campaignPolicy, campaignsEnabled, requireCampaignFeature } from "./access";
import { matchCampaignComment } from "./matcher";
import { legacyReadPause } from "./legacy-guard";
import { observeRateHint } from "./send-budget";

export const CAMPAIGN_QUEUE_CHANNEL = "campaign_jobs";
const ROUTE_LEASE_MS = 60_000;

export interface CampaignRouterDeps {
  db: Db;
  graph: GraphClient;
  now: () => Date;
  decryptToken: (encrypted: string) => string;
  hashKey: string;
}

export async function claimCampaignEvents(db: Db, options: { batch: number; now: Date }): Promise<CommentEvent[]> {
  if (options.batch <= 0) return [];
  return db.transaction(async (tx) => {
    const ids = await tx.select({ id: commentEvents.id }).from(commentEvents).where(and(
      or(and(eq(commentEvents.status, "campaign_pending"), lte(commentEvents.runAt, options.now)), and(eq(commentEvents.status, "campaign_processing"), lt(commentEvents.lockedAt, new Date(options.now.getTime() - ROUTE_LEASE_MS)))),
      sql`exists (select 1 from feature_flags f left join feature_flag_overrides o on o.flag_key = f.key and o.ig_account_id = ${commentEvents.igAccountId} where f.key = ${CAMPAIGN_FLAG} and f.enabled and coalesce(o.enabled, f.default_enabled))`,
      sql`exists (select 1 from ig_accounts a where a.id = ${commentEvents.igAccountId} and a.status = 'active' and a.access_token_enc is not null)`,
    )).orderBy(asc(commentEvents.runAt), asc(commentEvents.id)).limit(options.batch).for("update", { skipLocked: true });
    if (!ids.length) return [];
    return tx.update(commentEvents).set({ status: "campaign_processing", lockedAt: options.now, attempts: sql`${commentEvents.attempts} + 1` }).where(inArray(commentEvents.id, ids.map((row) => row.id))).returning();
  });
}

function fence(event: CommentEvent) {
  return and(eq(commentEvents.id, event.id), eq(commentEvents.status, "campaign_processing"), eq(commentEvents.attempts, event.attempts));
}

async function finishRoute(db: Executor, event: CommentEvent, now: Date, patch: Partial<NewCommentEvent>) {
  await db.update(commentEvents).set({ status: "campaign_routed", routeOwner: "campaign", lockedAt: null, completedAt: now, ...patch }).where(fence(event));
}

async function holdDisabled(db: Executor, event: CommentEvent, now: Date) {
  await db.update(commentEvents).set({ status: "campaign_pending", lockedAt: null, runAt: now, attempts: sql`greatest(${commentEvents.attempts} - 1, 0)` }).where(fence(event));
}

/** Network metadata reads are outside the transaction; the lease fence rejects late readers. */
export async function routeCampaignEvent(deps: CampaignRouterDeps, event: CommentEvent): Promise<string> {
  const { db } = deps;
  if (!await campaignsEnabled(db, event.igAccountId)) { await holdDisabled(db, event, deps.now()); return "held"; }
  const [account] = await db.select().from(igAccounts).where(eq(igAccounts.id, event.igAccountId));
  if (!account || account.status !== "active" || !account.accessTokenEnc) {
    await holdDisabled(db, event, deps.now()); return "account_inactive";
  }
  if ([account.igUserId, account.igScopedId].includes(event.commenterIgId)) {
    await finishRoute(db, event, deps.now(), { skipReason: "self" }); return "self";
  }
  if (event.campaignId && (!event.campaignRulesSnapshot || !event.stateAtReceipt)) {
    await finishRoute(db, event, deps.now(), { status: "campaign_failed", errorCode: "routing_context_missing" }); return "routing_failed";
  }
  const match = event.campaignRulesSnapshot && event.stateAtReceipt
    ? matchCampaignComment(event.campaignRulesSnapshot, event.stateAtReceipt, event.commentText) : "no_match";
  if (match === "no_match") {
    // Same persisted event, same legacy priority/keyword rules; never insert another webhook row.
    await finishRoute(db, event, deps.now(), { status: "pending", routeOwner: "legacy", campaignId: null, completedAt: null, runAt: deps.now(), attempts: 0, matchedRule: "legacy_fallback" });
    return "legacy";
  }
  if (match === "excluded") {
    await finishRoute(db, event, deps.now(), { matchedRule: match, skipReason: "campaign_excluded" }); return "excluded";
  }

  let createdAt = event.commentCreatedAt;
  try {
    if (!createdAt) {
      const pause = await legacyReadPause(db, account.id, deps.now());
      if (pause) {
        await db.update(commentEvents).set({ status: "campaign_pending", lockedAt: null, runAt: pause, attempts: sql`greatest(${commentEvents.attempts} - 1, 0)` }).where(fence(event));
        return "api_cooldown";
      }
      const metadata = await deps.graph.getComment(deps.decryptToken(account.accessTokenEnc), event.commentId);
      await observeRateHint(db, account.id, metadata.rateHint, deps.now());
      if (metadata.id !== event.commentId || metadata.mediaId !== event.mediaId || metadata.authorId !== event.commenterIgId) throw new CampaignError("invalid_comment_identity", "댓글 소유 정보가 일치하지 않아요");
      if (!metadata.createdAt) throw new CampaignError("missing_comment_timestamp", "댓글 작성 시각이 확인되지 않았어요");
      if (metadata.createdAt > deps.now()) throw new CampaignError("invalid_comment_timestamp", "댓글 작성 시각이 올바르지 않아요");
      createdAt = metadata.createdAt;
    }
  } catch (error) {
    const classified = classifyError(error);
    if (classified.cls === "auth") {
      await db.transaction(async (tx) => {
        const [changed] = await tx.update(igAccounts).set({ status: "reauth_required" }).where(and(eq(igAccounts.id, account.id), eq(igAccounts.status, "active"))).returning();
        if (changed) await tx.insert(campaignNotificationOutbox).values({ igAccountId: account.id, userId: account.userId, key: `read-auth:${event.id}`, kind: "reauth_required", reason: classified.code, nextAttemptAt: deps.now() }).onConflictDoNothing();
      });
      await holdDisabled(db, event, deps.now()); return "reauth_required";
    }
    const retryable = error instanceof CampaignError ? error.code === "missing_comment_timestamp" : ["transient", "rate_limited"].includes(classified.cls);
    const maxAttempts = await campaignPolicy(db, "max_attempts");
    const retry = retryable && event.attempts < maxAttempts;
    const retryAfterMs = error instanceof GraphApiError ? error.retryAfterMs ?? 0 : 0;
    if (retryAfterMs) await observeRateHint(db, account.id, { retryAfterMs }, deps.now());
    await finishRoute(db, event, deps.now(), {
      status: retry ? "campaign_pending" : "campaign_failed", matchedRule: match,
      errorCode: error instanceof CampaignError ? error.code : classified.code,
      errorMessage: "댓글 작성 정보를 확인하지 못했어요", // Never persist Meta error strings/tokens.
      completedAt: retry ? null : deps.now(), runAt: new Date(deps.now().getTime() + Math.max(retryAfterMs, Math.min(300_000, 1000 * 2 ** Math.min(event.attempts, 8)))),
    });
    return retry ? "metadata_retry" : "metadata_failed";
  }

  const now = deps.now();
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(commentEvents).where(fence(event)).for("update");
    if (!current) return "stale_lease";
    if (!await campaignsEnabled(tx, event.igAccountId)) { await holdDisabled(tx, event, now); return "held"; }
    const [campaign] = event.campaignId ? await tx.select().from(campaigns).where(and(eq(campaigns.id, event.campaignId), eq(campaigns.igAccountId, event.igAccountId))).for("update") : [];
    if (!campaign || campaign.archivedAt) {
      await finishRoute(tx, event, now, { matchedRule: match, skipReason: "campaign_inactive" }); return "campaign_inactive";
    }
    try {
      if (match === "notification") await requireCampaignFeature(tx, campaign.userId, "campaign.scheduled_dm");
      if (campaign.followOnly) await requireCampaignFeature(tx, campaign.userId, "campaign.follow_gate");
    } catch (error) {
      if (!(error instanceof CampaignError) || error.code !== "entitlement") throw error;
      await finishRoute(tx, event, now, { matchedRule: match, skipReason: "campaign_inactive", errorCode: "entitlement" }); return "entitlement";
    }
    const times = privateReplyDeadline(createdAt, await campaignPolicy(tx, "private_reply_window_seconds"), await campaignPolicy(tx, "private_reply_safety_seconds"));
    await tx.insert(campaignParticipants).values({
      campaignId: campaign.id, igAccountId: account.id, commenterIgId: event.commenterIgId,
      recipientHash: createHmac("sha256", deps.hashKey).update(`gonggu:${campaign.id}:${event.commenterIgId}`).digest("hex"),
      firstEventId: event.id, firstCommentCreatedAt: createdAt, notificationRequestedAt: match === "notification" ? event.receivedAt : null,
    }).onConflictDoNothing({ target: [campaignParticipants.campaignId, campaignParticipants.commenterIgId] });
    const [participant] = await tx.select().from(campaignParticipants).where(and(eq(campaignParticipants.campaignId, campaign.id), eq(campaignParticipants.commenterIgId, event.commenterIgId))).for("update");
    const [previous] = await tx.select().from(campaignDeliveries).where(and(eq(campaignDeliveries.participantId, participant.id), eq(campaignDeliveries.intent, "initial_contact")));
    if (previous) {
      const [oldJob] = await tx.select().from(dmJobs).where(eq(dmJobs.id, previous.owningJobId));
      // An entirely unattempted expired/canceled job did not contact the person.
      // A fresh comment may replace it; sent/unknown/failed or attempted jobs stay reserved.
      if (previous.state !== "reserved" || !oldJob || oldJob.attempts !== 0 || !["expired", "canceled"].includes(oldJob.status)) {
        await finishRoute(tx, event, now, { matchedRule: match, skipReason: "campaign_duplicate", commentCreatedAt: createdAt, timestampSource: "graph" }); return "duplicate";
      }
    }
    const jobId = randomUUID();
    const scheduledAt = match === "notification" ? campaign.openAt : now;
    const expired = times.deadlineAt <= now && !(match === "notification" && campaign.expiryFallbackEnabled && times.hardExpiresAt > now);
    const base = { campaignId: campaign.id, igAccountId: account.id, participantId: participant.id, sourceEventId: event.id, ...times, commentCreatedAt: createdAt };
    await tx.insert(dmJobs).values({ ...base, id: jobId, channel: "private_reply", kind: match === "notification" ? "opening_link" : match === "closed_notice" ? "closed_notice" : "instant_link", scheduledAt,
      nextAttemptAt: new Date(Math.min(scheduledAt.getTime(), times.deadlineAt.getTime())), status: expired ? "expired" : "waiting", completedAt: expired ? now : null,
      lastErrorCode: expired ? "deadline_passed" : null, idempotencyKey: `campaign:${campaign.id}:person:${participant.id}:initial:${event.id}`,
    });
    await tx.insert(campaignDeliveries).values([
      { participantId: participant.id, intent: "initial_contact", owningJobId: jobId },
      ...(match !== "closed_notice" ? [{ participantId: participant.id, intent: "link" as const, owningJobId: jobId }] : []),
    ]).onConflictDoUpdate({ target: [campaignDeliveries.participantId, campaignDeliveries.intent], set: { owningJobId: jobId, state: "reserved" } });
    await tx.insert(privateReplyClaims).values({ commentId: event.commentId, jobId });
    const stage = event.stateAtReceipt === "teaser" ? "teaser" : event.stateAtReceipt === "open" ? "open" : event.stateAtReceipt === "sold_out" ? "sold_out" : "closed";
    const [publicDelivery] = await tx.select().from(campaignDeliveries).where(and(eq(campaignDeliveries.participantId, participant.id), eq(campaignDeliveries.intent, "public_ack")));
    if (!expired && !publicDelivery && campaign.templates[stage].publicReplies.length > 0) {
      const publicId = randomUUID();
      await tx.insert(dmJobs).values({ ...base, id: publicId, channel: "public_reply", kind: "public_reply", scheduledAt: now, nextAttemptAt: now,
        publicTemplateIndex: campaign.publicReplySequence, idempotencyKey: `campaign:${campaign.id}:person:${participant.id}:public`,
      });
      await tx.insert(campaignDeliveries).values({ participantId: participant.id, intent: "public_ack", owningJobId: publicId });
      await tx.update(campaigns).set({ publicReplySequence: campaign.publicReplySequence + 1 }).where(eq(campaigns.id, campaign.id));
    }
    await finishRoute(tx, event, now, { matchedRule: match, commentCreatedAt: createdAt, timestampSource: "graph", errorCode: null, errorMessage: null });
    await tx.execute(sql`select pg_notify(${CAMPAIGN_QUEUE_CHANNEL}, '')`);
    return "routed";
  });
}
