import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, Executor } from "@/server/db/client";
import { accountSendAuditEvents, accountSendControls, campaignNotificationOutbox, dmJobs, igAccounts, sendBuckets } from "@/server/db/schema";
import { CampaignError, campaignsEnabled } from "./access";
import { ensureSendControls, sendPolicy } from "./send-budget";

async function authorize(db: Executor, userId: string, accountId: string) {
  const [account] = await db.select({ id: igAccounts.id }).from(igAccounts).where(and(eq(igAccounts.id, accountId), eq(igAccounts.userId, userId)));
  if (!account || !await campaignsEnabled(db, accountId)) throw new CampaignError("not_found", "공구 계정을 찾을 수 없어요");
}

export async function getSendOverview(db: Executor, userId: string, accountId: string, campaignId: string) {
  await authorize(db, userId, accountId);
  const [controls, buckets, counts, notifications, policy] = await Promise.all([
    db.select().from(accountSendControls).where(eq(accountSendControls.igAccountId, accountId)),
    db.select().from(sendBuckets).where(eq(sendBuckets.igAccountId, accountId)),
    db.select({ status: dmJobs.status, count: sql<number>`count(*)::int` }).from(dmJobs).where(and(eq(dmJobs.campaignId, campaignId), eq(dmJobs.igAccountId, accountId))).groupBy(dmJobs.status),
    db.select({ count: sql<number>`count(*)::int` }).from(campaignNotificationOutbox).where(and(eq(campaignNotificationOutbox.igAccountId, accountId), eq(campaignNotificationOutbox.status, "failed"))),
    sendPolicy(db),
  ]);
  const control = controls[0];
  return { version: control?.version ?? 0, manualPaused: control?.manualPaused ?? false, continueDmOnPublicPause: control?.continueDmOnPublicPause ?? false,
    privateReplyRate: control?.privateReplyRate ?? policy.private_reply_default_rate, maxPrivateRate: policy.private_reply_max_rate,
    warmupUntil: control?.warmupUntil?.toISOString() ?? null, apiPausedUntil: control?.apiPausedUntil?.toISOString() ?? null,
    buckets: buckets.map((b) => ({ channel: b.channel, pausedUntil: b.pausedUntil?.toISOString() ?? null, requiresReview: b.requiresReview, lastErrorCode: b.lastErrorCode })),
    counts: Object.fromEntries(counts.map((row) => [row.status, row.count])), failedNotifications: notifications[0].count,
  };
}

export const sendControlInput = z.object({ accountId: z.uuid(), expectedVersion: z.number().int().nonnegative(), requestId: z.uuid(), manualPaused: z.boolean(), privateReplyRate: z.number().int().positive(), continueDmOnPublicPause: z.boolean(), acknowledgePolicyReview: z.boolean().default(false) });

export async function updateSendControls(db: Db, userId: string, raw: unknown, now: Date) {
  const parsed = sendControlInput.safeParse(raw);
  if (!parsed.success) throw new CampaignError("validation", "발송 설정을 확인해주세요");
  const input = parsed.data;
  return db.transaction(async (tx) => {
    await authorize(tx, userId, input.accountId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`send-settings:${input.accountId}`}))`);
    const policy = await sendPolicy(tx);
    if (input.privateReplyRate > policy.private_reply_max_rate) throw new CampaignError("rate", "설정 가능한 발송 속도를 초과했어요");
    const [before] = await tx.select().from(accountSendControls).where(eq(accountSendControls.igAccountId, input.accountId));
    await ensureSendControls(tx, input.accountId, now, policy, { initialPrivateRate: input.privateReplyRate });
    const [control] = await tx.select().from(accountSendControls).where(eq(accountSendControls.igAccountId, input.accountId)).for("update");
    const [previous] = await tx.select().from(accountSendAuditEvents).where(and(eq(accountSendAuditEvents.igAccountId, input.accountId), eq(accountSendAuditEvents.requestId, input.requestId)));
    if (previous) return;
    if (input.expectedVersion !== (before ? control.version : 0)) throw new CampaignError("conflict", "발송 설정이 변경됐어요. 새로고침해주세요");
    await tx.update(accountSendControls).set({ manualPaused: input.manualPaused, privateReplyRate: input.privateReplyRate, continueDmOnPublicPause: input.continueDmOnPublicPause, version: control.version + 1 }).where(eq(accountSendControls.igAccountId, input.accountId));
    // Manual review acknowledges a policy stop; it never erases rate cooldowns or recent calls.
    if (input.acknowledgePolicyReview) await tx.update(sendBuckets).set({ requiresReview: false }).where(eq(sendBuckets.igAccountId, input.accountId));
    await tx.insert(accountSendAuditEvents).values({ igAccountId: input.accountId, actorId: userId, requestId: input.requestId, action: "settings_changed", reason: `${input.manualPaused ? "전체 일시정지" : "발송 허용"}; private ${input.privateReplyRate}/h; public pause DM ${input.continueDmOnPublicPause ? "계속" : "중지"}; policy review ${input.acknowledgePolicyReview ? "확인" : "유지"}`, createdAt: now });
  });
}
