import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Plan } from "@/lib/plans";
import { rulesToBind, selectAutomation } from "@/server/automations/matcher";
import { brandingLine, buildTextFallback, renderReply, truncateChars } from "@/server/automations/render";
import { getUserPlan } from "@/server/billing/plan-of";
import type { Db } from "@/server/db/client";
import {
  automations,
  commentEvents,
  igAccounts,
  mediaCache,
  type Automation,
  type CommentEvent,
  type IgAccount,
  type PartStatus,
  type SkipReason,
} from "@/server/db/schema";
import { classifyError, type ClassifiedError } from "@/server/instagram/errors";
import type { GraphClient } from "@/server/instagram/graph";
import { getOrCreateEventLink } from "@/server/links";
import { backoffDelayMs, MAX_ATTEMPTS } from "@/server/queue/backoff";
import { finishEvent, requeueEvent, updateEvent, type EventPatch } from "@/server/queue/events";
import { reserveSendSlot } from "@/server/ratelimit";
import { releaseDm, reserveDm } from "@/server/usage";
import { releaseDelivery, reserveDelivery } from "./deliveries";

export interface PipelineDeps {
  db: Db;
  graph: GraphClient;
  now: () => Date;
  random: () => number;
  sleep: (ms: number) => Promise<void>;
  appUrl: string;
  hourlyLimit: number;
  decryptToken: (enc: string) => string;
  onAuthFailure?: (account: IgAccount) => Promise<void>;
}

export type ProcessOutcome = "succeeded" | "partial" | "failed" | "skipped" | "expired" | "deferred" | "retry";

const SEND_WINDOW_MS = 7 * 86_400_000;
const MAX_INLINE_WAIT_MS = 5_000;
const RATE_LIMIT_RETRY_MS = 5 * 60_000;
const BUTTON_TEXT_MAX = 640;

interface Ctx {
  event: CommentEvent;
  account: IgAccount;
  usagePeriod: string | null;
}

export async function processCommentEvent(deps: PipelineDeps, event: CommentEvent): Promise<ProcessOutcome> {
  const { db } = deps;
  const now = deps.now();
  const deadline = event.receivedAt.getTime() + SEND_WINDOW_MS;

  const [account] = await db.select().from(igAccounts).where(eq(igAccounts.id, event.igAccountId)).limit(1);
  if (!account) return skip(deps, event.id, "account_inactive");
  const ctx: Ctx = { event, account, usagePeriod: event.usagePeriod };

  if (now.getTime() >= deadline) return expire(deps, ctx);
  if (account.status !== "active" || !account.accessTokenEnc) {
    await releaseReservations(db, ctx);
    return skip(deps, event.id, "account_inactive", { usagePeriod: null });
  }
  if (await isSelfComment(db, event, account)) return skip(deps, event.id, "self");

  let automation: Automation | null;
  if (event.automationId) {
    const [row] = await db.select().from(automations).where(eq(automations.id, event.automationId)).limit(1);
    automation = row?.isActive ? row : null;
    if (!automation) {
      await releaseReservations(db, ctx);
      return skip(deps, event.id, "automation_inactive", { usagePeriod: null });
    }
  } else {
    automation = await matchAutomation(deps, event, account);
    if (!automation) return skip(deps, event.id, "no_match");
    await updateEvent(db, event.id, { automationId: automation.id });
  }

  const plan = await getUserPlan(db, account.userId);

  const dedupe = await reserveDelivery(db, {
    automationId: automation.id,
    mediaId: event.mediaId,
    commenterIgId: event.commenterIgId,
    eventId: event.id,
  });
  if (dedupe === "duplicate") {
    if (ctx.usagePeriod) await releaseDm(db, account.userId, ctx.usagePeriod);
    return skip(deps, event.id, "duplicate", { usagePeriod: null });
  }

  if (!ctx.usagePeriod) {
    ctx.usagePeriod = await reserveDm(db, account.userId, plan.monthlyDmLimit, now);
    if (!ctx.usagePeriod) {
      await releaseDelivery(db, event.id);
      return skip(deps, event.id, "quota");
    }
    await updateEvent(db, event.id, { usagePeriod: ctx.usagePeriod });
  }

  const slot =
    event.dmReservedAt ??
    (await reserveSendSlot(db, {
      igAccountId: account.id,
      eventId: event.id,
      now,
      hourlyLimit: deps.hourlyLimit,
      random: deps.random,
    }));
  if (slot.getTime() >= deadline) return expire(deps, ctx);
  const wait = slot.getTime() - now.getTime();
  if (wait > MAX_INLINE_WAIT_MS) {
    await requeueEvent(db, event.id, slot, {}, { refundAttempt: true });
    return "deferred";
  }
  if (wait > 0) await deps.sleep(wait);

  return sendAndSettle(deps, ctx, automation, plan, deadline);
}

async function sendAndSettle(
  deps: PipelineDeps,
  ctx: Ctx,
  automation: Automation,
  plan: Plan,
  deadline: number,
): Promise<ProcessOutcome> {
  const { db } = deps;
  const { event, account } = ctx;
  const token = deps.decryptToken(account.accessTokenEnc ?? "");

  let replyStatus = event.replyStatus;
  let dmStatus = event.dmStatus;
  let replyError: ClassifiedError | null = null;
  let dmError: ClassifiedError | null = null;

  if (!automation.replyEnabled || automation.replyTexts.length === 0) {
    replyStatus = "skipped";
  } else if (replyStatus === null) {
    const template = automation.replyTexts[Math.floor(deps.random() * automation.replyTexts.length)];
    try {
      const res = await deps.graph.replyToComment(
        token,
        event.parentCommentId ?? event.commentId,
        renderReply(template, event.commenterUsername),
      );
      replyStatus = "sent";
      await updateEvent(db, event.id, { replyStatus, replyCommentId: res.id });
    } catch (e) {
      replyError = classifyError(e);
      if (isFinalError(replyError)) replyStatus = "failed";
    }
  }
  if (replyStatus !== event.replyStatus) await updateEvent(db, event.id, { replyStatus });

  if (dmStatus === null && replyError?.cls !== "auth") {
    try {
      const res = await sendDm(deps, { account, automation, event, plan, token });
      dmStatus = "sent";
      await updateEvent(db, event.id, { dmStatus, dmMessageId: res.messageId });
    } catch (e) {
      dmError = classifyError(e);
      if (isFinalError(dmError)) {
        dmStatus = "failed";
        await updateEvent(db, event.id, { dmStatus });
      }
    }
  }

  const errors = [replyError, dmError].filter((e): e is ClassifiedError => e !== null);

  if (errors.some((e) => e.cls === "auth")) {
    await db.update(igAccounts).set({ status: "reauth_required" }).where(eq(igAccounts.id, account.id));
    await deps.onAuthFailure?.(account);
    return settle(deps, ctx, replyStatus ?? "failed", dmStatus ?? "failed", errors.find((e) => e.cls === "auth") ?? null);
  }

  const retryable = errors.filter((e) => e.cls === "rate_limited" || e.cls === "transient");
  if (retryable.length > 0) {
    const rateLimited = retryable.some((e) => e.cls === "rate_limited");
    const delay = rateLimited ? RATE_LIMIT_RETRY_MS : backoffDelayMs(event.attempts, deps.random);
    const runAt = new Date(deps.now().getTime() + delay);
    if ((rateLimited || event.attempts < MAX_ATTEMPTS) && runAt.getTime() < deadline) {
      await requeueEvent(
        db,
        event.id,
        runAt,
        { dmReservedAt: null, errorCode: retryable[0].code, errorMessage: retryable[0].message },
        { refundAttempt: rateLimited },
      );
      return "retry";
    }
  }

  return settle(deps, ctx, replyStatus ?? "failed", dmStatus ?? "failed", errors[0] ?? null);
}

function isFinalError(e: ClassifiedError): boolean {
  return e.cls === "permanent" || e.cls === "invalid_message";
}

async function settle(
  deps: PipelineDeps,
  ctx: Ctx,
  replyStatus: PartStatus,
  dmStatus: PartStatus,
  error: ClassifiedError | null,
): Promise<ProcessOutcome> {
  const replyOk = replyStatus !== "failed";
  const dmOk = dmStatus === "sent";
  const status = replyOk && dmOk ? "succeeded" : replyStatus === "sent" || dmOk ? "partial" : "failed";
  if (!dmOk) await releaseReservations(deps.db, ctx);
  await finishEvent(
    deps.db,
    ctx.event.id,
    status,
    {
      replyStatus,
      dmStatus,
      usagePeriod: ctx.usagePeriod,
      errorCode: status === "succeeded" ? null : (error?.code ?? ctx.event.errorCode),
      errorMessage: status === "succeeded" ? null : (error?.message ?? ctx.event.errorMessage),
    },
    deps.now(),
  );
  return status;
}

async function releaseReservations(db: Db, ctx: Ctx): Promise<void> {
  await releaseDelivery(db, ctx.event.id);
  if (ctx.usagePeriod) {
    await releaseDm(db, ctx.account.userId, ctx.usagePeriod);
    ctx.usagePeriod = null;
  }
}

async function expire(deps: PipelineDeps, ctx: Ctx): Promise<ProcessOutcome> {
  await releaseReservations(deps.db, ctx);
  await finishEvent(deps.db, ctx.event.id, "expired", { errorCode: "expired", usagePeriod: null }, deps.now());
  return "expired";
}

async function skip(
  deps: PipelineDeps,
  id: string,
  reason: SkipReason,
  patch: EventPatch = {},
): Promise<ProcessOutcome> {
  await finishEvent(deps.db, id, "skipped", { skipReason: reason, ...patch }, deps.now());
  return "skipped";
}

async function isSelfComment(db: Db, event: CommentEvent, account: IgAccount): Promise<boolean> {
  if (event.commenterIgId === account.igUserId) return true;
  if (event.commenterUsername && event.commenterUsername.toLowerCase() === account.username.toLowerCase()) {
    return true;
  }
  const [own] = await db
    .select({ id: commentEvents.id })
    .from(commentEvents)
    .where(eq(commentEvents.replyCommentId, event.commentId))
    .limit(1);
  return Boolean(own);
}

async function matchAutomation(deps: PipelineDeps, event: CommentEvent, account: IgAccount): Promise<Automation | null> {
  const { db } = deps;
  const loadRules = () =>
    db
      .select()
      .from(automations)
      .where(and(eq(automations.igAccountId, account.id), eq(automations.isActive, true)));

  let rules = await loadRules();
  if (rules.length === 0) return null;

  const unbound = rules.filter((r) => r.mediaScope === "next" && r.mediaId === null);
  if (unbound.length > 0) {
    const media = await getMediaInfo(deps, account, event.mediaId);
    const ids = rulesToBind(unbound, media?.timestamp ?? null);
    if (ids.length > 0) {
      await db
        .update(automations)
        .set({
          mediaScope: "specific",
          mediaId: event.mediaId,
          mediaPermalink: media?.permalink ?? null,
          mediaThumbnailUrl: media?.thumbnailUrl ?? null,
          mediaCaption: media?.caption ? truncateChars(media.caption, 300) : null,
        })
        .where(and(inArray(automations.id, ids), isNull(automations.mediaId)));
      rules = await loadRules();
    }
  }
  return selectAutomation(rules, event.mediaId, event.commentText);
}

async function getMediaInfo(
  deps: PipelineDeps,
  account: IgAccount,
  mediaId: string,
): Promise<{ timestamp: Date | null; permalink: string | null; thumbnailUrl: string | null; caption: string | null } | null> {
  const [cached] = await deps.db.select().from(mediaCache).where(eq(mediaCache.mediaId, mediaId)).limit(1);
  if (cached) return cached;
  try {
    const m = await deps.graph.getMedia(deps.decryptToken(account.accessTokenEnc ?? ""), mediaId);
    const row = {
      mediaId,
      igAccountId: account.id,
      timestamp: m.timestamp,
      permalink: m.permalink,
      thumbnailUrl: m.thumbnailUrl ?? m.mediaUrl,
      caption: m.caption,
      mediaProductType: m.mediaProductType,
      fetchedAt: deps.now(),
    };
    await deps.db.insert(mediaCache).values(row).onConflictDoNothing();
    return row;
  } catch {
    return null;
  }
}

async function sendDm(
  deps: PipelineDeps,
  p: { account: IgAccount; automation: Automation; event: CommentEvent; plan: Plan; token: string },
): Promise<{ messageId: string }> {
  const { account, automation, event, plan, token } = p;
  const url = plan.linkTracking
    ? `${deps.appUrl}/l/${await getOrCreateEventLink(deps.db, {
        eventId: event.id,
        automationId: automation.id,
        targetUrl: automation.dmLinkUrl,
      })}`
    : automation.dmLinkUrl;
  const text = plan.branding ? `${automation.dmText}\n\n${brandingLine()}` : automation.dmText;
  const textMessage = { kind: "text" as const, text: buildTextFallback(text, automation.dmButtonTitle, url) };

  if (account.dmFormat === "text") {
    return deps.graph.sendPrivateReply(token, account.igUserId, event.commentId, textMessage);
  }
  try {
    return await deps.graph.sendPrivateReply(token, account.igUserId, event.commentId, {
      kind: "button",
      text: truncateChars(text, BUTTON_TEXT_MAX),
      buttonTitle: automation.dmButtonTitle,
      url,
    });
  } catch (e) {
    if (classifyError(e).cls !== "invalid_message") throw e;
    const res = await deps.graph.sendPrivateReply(token, account.igUserId, event.commentId, textMessage);
    await deps.db.update(igAccounts).set({ dmFormat: "text" }).where(eq(igAccounts.id, account.id));
    return res;
  }
}
