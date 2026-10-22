import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { campaignParticipants, campaignPolicies, commentEvents, dataDeletionRequests, dmJobs, featureFlags, igAccounts, messageEvents, reportReferralSignups, reportShares, reportSnapshots, sendAttempts } from "@/server/db/schema";
import { getSql } from "@/server/db/client";
import { redactCampaignContent } from "@/server/campaigns/retention";
import { campaignReportMetrics } from "@/server/campaigns/report";
import { createReportShare, sharedReport } from "@/server/campaigns/report-shares";
import { getCachedReportPdf, putCachedReportPdf, reportPdfCacheGeneration } from "@/server/campaigns/report-pdf-cache";
import { handleDataDeletion } from "@/server/instagram/meta-callbacks";
import { cleanupOldData } from "@/worker/jobs";
import { resetDb } from "../helpers/db";
import { createEvent } from "../helpers/factories";
import { seedCampaignConfig } from "../helpers/campaigns";
import { reportSharingWorld } from "../helpers/report-sharing";
const DAY = 86_400_000;
async function oldWorld() {
  const w = await reportSharingWorld(); const old = new Date(w.now.getTime() - 181 * DAY);
  const event = await createEvent(w.account, { campaignId: w.campaign.id, routeOwner: "campaign", status: "send_unknown", commenterUsername: "customer", commentText: "개인 문의", errorMessage: "개인 내용 포함", receivedAt: old, createdAt: old, flagCheckedAt: old });
  const [person] = await w.db.insert(campaignParticipants).values({ campaignId: w.campaign.id, igAccountId: w.account.id, commenterIgId: event.commenterIgId, recipientHash: createHash("sha256").update(event.commenterIgId).digest("hex"), firstEventId: event.id, firstCommentCreatedAt: old }).returning();
  const [job] = await w.db.insert(dmJobs).values({ campaignId: w.campaign.id, igAccountId: w.account.id, participantId: person.id, sourceEventId: event.id, channel: "private_reply", kind: "instant_link", status: "unknown", scheduledAt: old, nextAttemptAt: old, deadlineAt: old, hardExpiresAt: old, commentCreatedAt: old, createdAt: old, idempotencyKey: randomUUID(), attempts: 1 }).returning();
  const [attempt] = await w.db.insert(sendAttempts).values({ igAccountId: w.account.id, campaignId: w.campaign.id, jobId: job.id, logicalKey: randomUUID(), channel: "private_reply", attempt: 1, leaseOwner: "fixture", leaseVersion: 1, state: "not_invoked", startedAt: old, permitExpiresAt: old, requestFingerprint: "fixture", payload: { kind: "text", text: "개인 내용을 포함한 답장" } }).returning();
  await w.db.insert(messageEvents).values(["pending", "failed", "send_unknown"].map((status) => ({ igAccountId: w.account.id, peerId: "customer", eventKey: randomUUID(), providerMessageId: randomUUID(), kind: "message" as const, occurredAt: old, receivedAt: old, userMessageEvidence: true, text: "원문 개인정보", payload: "private-payload", nextAttemptAt: old, status: status as "pending" | "failed" | "send_unknown" })));
  return { ...w, event, job, attempt, old };
}
describe("campaign content retention and complete deletion", () => {
  beforeEach(async () => { await resetDb(); await seedCampaignConfig(); });
  it("redacts every status, preserves uncertain outcomes/report totals and leaves recent content alone", async () => {
    const w = await oldWorld(); const fresh = await createEvent(w.account, { campaignId: w.campaign.id, commentText: "최근 문의", commenterUsername: "recent" });
    const before = await campaignReportMetrics(w.db, w.campaign.id, w.now); const snapshot = (await w.db.select().from(reportSnapshots))[0].data;
    await w.db.update(featureFlags).set({ enabled: false });
    expect(await redactCampaignContent(w.db, w.now)).toEqual({ comments: 1, messages: 3, payloads: 1 });
    expect(await redactCampaignContent(w.db, w.now)).toEqual({ comments: 0, messages: 0, payloads: 0 });
    expect((await w.db.select().from(commentEvents).where(eq(commentEvents.id, w.event.id)))[0]).toMatchObject({ commentText: "", commenterUsername: null, errorMessage: null, status: "send_unknown", contentRedactedAt: w.now });
    expect((await w.db.select().from(commentEvents).where(eq(commentEvents.id, fresh.id)))[0]).toMatchObject({ commentText: "최근 문의", commenterUsername: "recent", contentRedactedAt: null });
    expect((await w.db.select().from(messageEvents)).every(m => !m.text && m.payload === null && m.contentRedactedAt !== null)).toBe(true);
    expect((await w.db.select().from(sendAttempts))[0]).toMatchObject({ state: "not_invoked", payload: null });
    await cleanupOldData(w.db, w.now);
    expect((await w.db.select().from(dmJobs))[0]).toMatchObject({ id: w.job.id, status: "unknown", attempts: 1 });
    expect(await campaignReportMetrics(w.db, w.campaign.id, w.now)).toEqual(before); expect((await w.db.select().from(reportSnapshots))[0].data).toEqual(snapshot);
  });
  it("keeps guarded legacy facts past the old 180-day delete threshold and processes bounded batches", async () => {
    const w = await oldWorld(); await createEvent(w.account, { status: "succeeded", guardedJitterUntil: w.old, createdAt: w.old, receivedAt: w.old });
    const r = await redactCampaignContent(w.db, w.now, 1); expect(r.comments).toBe(1); expect(r.messages).toBe(1);
    await cleanupOldData(w.db, w.now); expect(await w.db.select().from(commentEvents)).toHaveLength(2);
    await expect(redactCampaignContent(w.db, w.now)).resolves.toMatchObject({ comments: 1, messages: 2 });
    await w.db.update(campaignPolicies).set({ value: 91 }).where(eq(campaignPolicies.key, "raw_content_retention_days"));
    await createEvent(w.account, { campaignId: w.campaign.id }); await expect(redactCampaignContent(w.db, w.now)).rejects.toThrow("invalid_raw_content_retention_days");
  });
  it("atomically deletes account reports, issued links, referral facts, messages and cached PDFs", async () => {
    const w = await oldWorld(); const share = await createReportShare(w.db, w.user.id, w.shareInput, w.now);
    await w.db.insert(reportReferralSignups).values({ userId: w.user.id, snapshotId: w.snapshot.id, shareId: share.id, touchedAt: w.now });
    putCachedReportPdf(`share:${share.id}`, Buffer.from("fixture"), reportPdfCacheGeneration()); expect(getCachedReportPdf(`share:${share.id}`)).toBeDefined();
    const result = await handleDataDeletion(w.db, w.account.igUserId, "https://ringpo.test");
    expect(await sharedReport(w.db, share.token, w.now)).toBeNull(); expect(getCachedReportPdf(`share:${share.id}`)).toBeUndefined();
    for (const table of [campaignParticipants, dmJobs, commentEvents, messageEvents, sendAttempts, reportSnapshots, reportShares, reportReferralSignups]) expect(await w.db.select().from(table)).toHaveLength(0);
    expect((await w.db.select().from(dataDeletionRequests))[0]).toMatchObject({ confirmationCode: result.confirmationCode, status: "completed" });
  });
  it("rolls back disconnection and completion when related-data deletion fails", async () => {
    const w = await oldWorld(); const share = await createReportShare(w.db, w.user.id, w.shareInput, w.now);
    const sql = getSql();
    await sql.unsafe("CREATE FUNCTION fixture_delete_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$");
    await sql.unsafe("CREATE TRIGGER fixture_delete_failure BEFORE DELETE ON report_shares FOR EACH ROW EXECUTE FUNCTION fixture_delete_failure()");
    try {
      await expect(handleDataDeletion(w.db, w.account.igUserId, "https://ringpo.test")).rejects.toThrow();
      expect((await w.db.select().from(igAccounts))[0]).toMatchObject({ status: "active", accessTokenEnc: w.account.accessTokenEnc });
      expect(await sharedReport(w.db, share.token, w.now)).not.toBeNull(); expect(await w.db.select().from(dataDeletionRequests)).toHaveLength(0);
    } finally { await sql.unsafe("DROP TRIGGER fixture_delete_failure ON report_shares"); await sql.unsafe("DROP FUNCTION fixture_delete_failure()"); }
  });
});
