import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/server/db/client";
import { accountSendControls, campaignAuditEvents, campaignNotificationOutbox, campaignPolicies, dmJobs, featureFlags, sendAttempts, sendBuckets } from "@/server/db/schema";
import { decryptSecret } from "@/server/crypto";
import { GraphApiError } from "@/server/instagram/errors";
import { retryCampaignJob } from "@/server/campaigns/retry";
import { accountOperations, queueCampaignAlerts } from "@/server/campaigns/operations";
import { sendCampaignNotifications } from "@/server/campaigns/notifications";
import { dispatchCampaignJob, type DispatchDeps } from "@/server/campaigns/dispatch";
import { claimCampaignJobs } from "@/server/campaigns/jobs";
import { claimCampaignEvents, routeCampaignEvent } from "@/server/campaigns/routing";
import { saveCampaign, publishCampaign } from "@/server/campaigns/service";
import { ingestComments } from "@/server/queue/ingest";
import { CAMPAIGN_NOW, campaignWorld, seedCampaignConfig } from "../helpers/campaigns";
import { createIgAccount, createUser, setPlan } from "../helpers/factories";
import { resetDb } from "../helpers/db";

async function world() {
  const db = getDb(); const user = await createUser(); const account = await createIgAccount(user.id); await setPlan(user.id, "pro");
  const { graph, input } = campaignWorld(account); let now = new Date(input.openAt);
  const campaign = await saveCampaign(db, user.id, input, { graph, decrypt: decryptSecret, now: CAMPAIGN_NOW, appUrl: "https://app.test" });
  await publishCampaign(db, user.id, campaign.id, true, now);
  graph.comments.comment = { id: "comment", authorId: "peer", mediaId: input.mediaIds[0], createdAt: now };
  await ingestComments(db, [{ igUserId: account.igUserId, commentId: "comment", commenterIgId: "peer", commenterUsername: "fixture", mediaId: input.mediaIds[0], mediaProductType: "FEED", parentCommentId: null, text: "링크" }], now);
  for (const event of await claimCampaignEvents(db, { batch: 10, now })) await routeCampaignEvent({ db, graph, now: () => now, decryptToken: decryptSecret, hashKey: "fixture" }, event);
  await db.update(campaignPolicies).set({ value: 1 }).where(eq(campaignPolicies.key, "max_attempts"));
  await db.update(campaignPolicies).set({ value: 2 }).where(eq(campaignPolicies.key, "manual_retry_extra_attempts"));
  const deps: DispatchDeps = { db, graph, decryptToken: decryptSecret, random: () => 0, clock: async () => now, render: async () => ({ kind: "text", text: "링크" }) };
  const tick = async () => { for (const job of await claimCampaignJobs(db, { batch: 10, now, workerId: "operations" })) await dispatchCampaignJob(deps, job); };
  const reject = vi.spyOn(graph, "sendPrivateReply").mockRejectedValue(new GraphApiError("rate", 400, 4));
  await tick(); now = new Date(now.getTime() + 3000); await tick();
  const [job] = await db.select().from(dmJobs).where(eq(dmJobs.channel, "private_reply")); expect(job.status).toBe("failed");
  return { db, user, account, campaign, graph, job, reject, tick, now: () => now, advance: (ms: number) => { now = new Date(now.getTime() + ms); }, request: () => ({ campaignId: campaign.id, jobId: job.id, requestId: randomUUID() }) };
}

describe("campaign operational controls", () => {
  beforeEach(async () => { await resetDb(); await seedCampaignConfig(); });
  it("grants one idempotent retry batch, preserves history and pause, then sends the same intention once", async () => {
    const w = await world(); const input = w.request();
    await w.db.update(accountSendControls).set({ manualPaused: true }).where(eq(accountSendControls.igAccountId, w.account.id));
    const before = await w.db.select().from(sendBuckets);
    await Promise.all([retryCampaignJob(w.db, w.user.id, input, w.now()), retryCampaignJob(w.db, w.user.id, input, w.now())]);
    expect(await w.db.select().from(sendBuckets)).toEqual(before);
    expect(await w.db.select().from(campaignAuditEvents).where(eq(campaignAuditEvents.action, "job_retry"))).toHaveLength(1);
    await expect(retryCampaignJob(w.db, w.user.id, w.request(), w.now())).rejects.toMatchObject({ code: "retry_unavailable" });
    w.advance(3000); await w.tick(); expect(w.reject).toHaveBeenCalledTimes(1);
    w.reject.mockRestore(); await w.db.update(accountSendControls).set({ manualPaused: false }).where(eq(accountSendControls.igAccountId, w.account.id));
    w.advance(61_000); await w.tick();
    const [after] = await w.db.select().from(dmJobs).where(eq(dmJobs.id, w.job.id));
    expect(after).toMatchObject({ status: "sent", attempts: 2, retryAllowance: 2, idempotencyKey: w.job.idempotencyKey });
    expect(w.graph.dms).toHaveLength(1);
    expect((await w.db.select().from(sendAttempts).where(eq(sendAttempts.jobId, w.job.id))).map((a) => a.state)).toEqual(["rejected", "accepted"]);
  });
  it("stops again when the bounded additional batch is exhausted", async () => {
    const w = await world(); await w.db.update(campaignPolicies).set({ value: 20 }).where(eq(campaignPolicies.key, "breaker_streak"));
    await retryCampaignJob(w.db, w.user.id, w.request(), w.now());
    for (let i = 0; i < 4; i++) { w.advance(300_000); await w.tick(); }
    const [after] = await w.db.select().from(dmJobs).where(eq(dmJobs.id, w.job.id));
    expect(after).toMatchObject({ status: "failed", attempts: 3, retryAllowance: 2 }); expect(w.reject).toHaveBeenCalledTimes(3);
    await expect(retryCampaignJob(w.db, w.user.id, w.request(), w.now())).rejects.toMatchObject({ code: "retry_unavailable" });
  });
  it.each(["unknown", "sending", "accepted", "late_accepted", "permanent"])("refuses unsafe history even if someone changed the job to failed: %s", async (state) => {
    const w = await world();
    await w.db.update(sendAttempts).set(state === "late_accepted" ? { lateResult: { state: "accepted", providerMessageId: "mid" } } : state === "permanent" ? { errorCode: "100/2534025" } : { state: state as "unknown" | "sending" | "accepted" }).where(eq(sendAttempts.jobId, w.job.id));
    await expect(retryCampaignJob(w.db, w.user.id, w.request(), w.now())).rejects.toMatchObject({ code: "retry_unavailable" });
    expect(w.reject).toHaveBeenCalledTimes(1);
  });
  it("rejects another seller, flag OFF, expired windows and mismatched request reuse", async () => {
    const w = await world(); const outsider = await createUser();
    await expect(retryCampaignJob(w.db, outsider.id, w.request(), w.now())).rejects.toMatchObject({ code: "not_found" });
    await w.db.update(featureFlags).set({ enabled: false }).where(eq(featureFlags.key, "gonggu_campaigns"));
    await expect(retryCampaignJob(w.db, w.user.id, w.request(), w.now())).rejects.toMatchObject({ code: "disabled" });
    await w.db.update(featureFlags).set({ enabled: true }).where(eq(featureFlags.key, "gonggu_campaigns"));
    await expect(retryCampaignJob(w.db, w.user.id, w.request(), new Date(w.job.deadlineAt.getTime() + 1))).rejects.toMatchObject({ code: "retry_unavailable" });
    const input = w.request(); await retryCampaignJob(w.db, w.user.id, input, w.now());
    await expect(retryCampaignJob(w.db, w.user.id, { ...input, jobId: randomUUID() }, w.now())).rejects.toMatchObject({ code: "conflict" });
  });
  it("counts real outcomes and error codes, queues one durable daily notice and uses the operations email", async () => {
    const w = await world(); const overview = await accountOperations(w.db, w.account.id, w.campaign.id, w.now());
    expect(overview.rates.find((r) => r.channel === "private_reply")).toMatchObject({ invoked: 1, accepted: 0 });
    expect(overview.errors).toContainEqual({ code: "4", count: 1 }); expect(overview.failedJobs[0].retryCandidate).toBe(true);
    await w.db.update(dmJobs).set({ status: "unknown" }).where(eq(dmJobs.id, w.job.id));
    expect((await accountOperations(w.db, w.account.id, w.campaign.id, w.now())).queue.unknown).toBe(1);
    expect(await queueCampaignAlerts(w.db, w.now())).toBe(1); expect(await queueCampaignAlerts(w.db, w.now())).toBe(0);
    const send = vi.fn().mockResolvedValue(undefined); expect(await sendCampaignNotifications(w.db, w.now(), send)).toBe(1);
    expect(send.mock.calls[0][0].text).toContain("확인 필요 1건"); expect(send.mock.calls[0][0].subject).toContain("공구 발송 확인");
    expect(send.mock.calls[0][1]).toMatchObject({ requireConfigured: true });
    expect(await w.db.select().from(campaignNotificationOutbox).where(and(eq(campaignNotificationOutbox.kind, "operations_attention"), eq(campaignNotificationOutbox.status, "sent")))).toHaveLength(1);
  });
});
