import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { campaignAuditEvents, campaignDeliveries, campaigns, commentEvents, dmJobs, messageEvents, privateReplyClaims, sendAttempts } from "@/server/db/schema";
import { CampaignError, campaignPolicy, requireCampaignAccount } from "./access";
import { effectiveCampaignState } from "./state";

export const retryJobInput = z.object({ campaignId: z.uuid(), jobId: z.uuid(), requestId: z.uuid() });
export function isDefiniteRateRejection(code: string | null) { return Boolean(code && /^(?:4|17|32|613|80002)(?:\/\d+)?$|^http_429$/.test(code)); }

/** One explicit extra batch on the SAME intention; uncertain sends can never use this path. */
export async function retryCampaignJob(db: Db, userId: string, raw: unknown, now: Date) {
  const parsed = retryJobInput.safeParse(raw);
  if (!parsed.success) throw new CampaignError("validation", "재처리할 작업을 확인해주세요");
  const input = parsed.data;
  return db.transaction(async (tx) => {
    const [campaign] = await tx.select().from(campaigns).where(and(eq(campaigns.id, input.campaignId), eq(campaigns.userId, userId))).for("update");
    if (!campaign) throw new CampaignError("not_found", "공구를 찾을 수 없어요");
    await requireCampaignAccount(tx, userId, campaign.igAccountId);
    const requestId = `retry:${input.requestId}`;
    const [previous] = await tx.select().from(campaignAuditEvents).where(and(eq(campaignAuditEvents.campaignId, campaign.id), eq(campaignAuditEvents.requestId, requestId)));
    if (previous) {
      if (previous.action !== "job_retry" || previous.reason !== `확정 일시 거부 재처리: ${input.jobId}`) throw new CampaignError("conflict", "이미 사용한 요청이에요");
      return;
    }
    const [job] = await tx.select().from(dmJobs).where(and(eq(dmJobs.id, input.jobId), eq(dmJobs.campaignId, campaign.id))).for("update");
    const refuse = () => { throw new CampaignError("retry_unavailable", "안전하게 재처리할 수 없는 작업이에요. 발송 기록과 기한을 확인해주세요."); };
    if (!job || job.status !== "failed" || job.retryAllowance !== 0 || job.providerMessageId || !isDefiniteRateRejection(job.lastErrorCode)) return refuse();
    const state = effectiveCampaignState(campaign, now);
    if (campaign.archivedAt || state === "settled" || (["closed", "sold_out"].includes(state) && job.kind !== "closed_notice") || job.deadlineAt <= now || job.hardExpiresAt <= now) return refuse();
    const attempts = await tx.select().from(sendAttempts).where(eq(sendAttempts.logicalKey, job.idempotencyKey));
    if (!attempts.some((a) => a.state === "rejected") || attempts.some((a) => a.lateResult || a.providerMessageId || (a.state !== "not_invoked" && (a.state !== "rejected" || !isDefiniteRateRejection(a.errorCode))))) return refuse();
    const [source] = job.sourceEventId ? await tx.select().from(commentEvents).where(eq(commentEvents.id, job.sourceEventId)) : [];
    if (job.channel !== "message" && (!source || source.contentRedactedAt)) return refuse();
    if (job.channel === "private_reply") {
      const [claim] = await tx.select().from(privateReplyClaims).where(eq(privateReplyClaims.commentId, source!.commentId));
      if (claim?.jobId !== job.id || claim.state !== "reserved") return refuse();
    }
    if (job.channel === "message") {
      const [message] = job.sourceMessageEventId ? await tx.select().from(messageEvents).where(eq(messageEvents.id, job.sourceMessageEventId)) : [];
      if (!message || message.deletedAt || message.contentRedactedAt) return refuse();
    }
    const allowance = await campaignPolicy(tx, "manual_retry_extra_attempts");
    if (!Number.isInteger(allowance) || allowance < 1 || allowance > 10) return refuse();
    // Dispatch rechecks entitlement, live source window, handoff, pause and all rate budgets.
    await tx.update(dmJobs).set({ status: "retry", retryAllowance: allowance, completedAt: null, nextAttemptAt: now, jitterUntil: null, leaseOwner: null, leaseUntil: null }).where(eq(dmJobs.id, job.id));
    await tx.update(campaignDeliveries).set({ state: "reserved" }).where(and(eq(campaignDeliveries.owningJobId, job.id), eq(campaignDeliveries.state, "failed")));
    await tx.insert(campaignAuditEvents).values({ campaignId: campaign.id, actorId: userId, action: "job_retry", version: campaign.version, requestId, reason: `확정 일시 거부 재처리: ${job.id}`, effectiveAt: now, createdAt: now });
  });
}
