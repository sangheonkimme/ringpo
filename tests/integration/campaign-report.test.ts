import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getCampaignReport } from "@/server/campaigns/report";
import { createReportSnapshot, getOwnedReportSnapshot, processCampaignReports, saveManualOrders } from "@/server/campaigns/report-operations";
import { publishCampaign, saveCampaign, transitionCampaign } from "@/server/campaigns/service";
import { decryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { campaignClickEvents, campaignParticipants, campaignProducts, campaignReportRequests, campaigns, campaignTrackedLinks, commentEvents, dmJobs, featureFlags, manualOrderEntries, reportSnapshots, type Campaign, type DmJob } from "@/server/db/schema";
import { campaignWorld, CAMPAIGN_NOW, seedCampaignConfig } from "../helpers/campaigns";
import { resetDb } from "../helpers/db";
import { createIgAccount, createUser, setPlan } from "../helpers/factories";

const now = CAMPAIGN_NOW; const later = (ms: number) => new Date(+now + ms);
async function world() {
  const db = getDb(); const user = await createUser(); const account = await createIgAccount(user.id); await setPlan(user.id, "pro"); const { graph, input } = campaignWorld(account);
  let campaign = await saveCampaign(db, user.id, input, { graph, decrypt: decryptSecret, now, appUrl: "https://app.test" });
  campaign = await publishCampaign(db, user.id, campaign.id, false, now);
  campaign = await transitionCampaign(db, user.id, campaign.id, "open", { now, expectedVersion: campaign.version, requestId: randomUUID(), reason: "fixture" });
  async function job(kind: DmJob["kind"], status: DmJob["status"], person: string = randomUUID()) {
    const [event] = await db.insert(commentEvents).values({ igAccountId: account.id, campaignId: campaign.id, commentId: randomUUID(), commenterIgId: person, commenterUsername: "private-username", commentText: "private-comment", mediaId: input.mediaIds[0], routeOwner: "campaign", status: "campaign_routed" }).returning();
    await db.insert(campaignParticipants).values({ campaignId: campaign.id, igAccountId: account.id, commenterIgId: person, recipientHash: createHash("sha256").update(person).digest("hex"), firstEventId: event.id, firstCommentCreatedAt: now, notificationRequestedAt: now }).onConflictDoNothing();
    const [participant] = await db.select().from(campaignParticipants).where(and(eq(campaignParticipants.campaignId, campaign.id), eq(campaignParticipants.commenterIgId, person)));
    const [job] = await db.insert(dmJobs).values({ campaignId: campaign.id, igAccountId: account.id, participantId: participant.id, sourceEventId: event.id, kind, status, channel: kind === "public_reply" ? "public_reply" : kind === "follow_link" ? "message" : "private_reply", scheduledAt: now, nextAttemptAt: now, deadlineAt: later(86_400_000), hardExpiresAt: later(2 * 86_400_000), commentCreatedAt: now, createdAt: now, completedAt: status === "waiting" ? null : now, idempotencyKey: randomUUID(), attempts: 3, providerMessageId: status === "sent" ? randomUUID() : null }).returning();
    return { job, participant };
  }
  async function click(j: Awaited<ReturnType<typeof job>>, productId?: string, at = now) {
    const [product] = await db.select().from(campaignProducts).where(eq(campaignProducts.campaignId, campaign.id));
    const [link] = await db.insert(campaignTrackedLinks).values({ campaignId: campaign.id, productId: productId ?? product.id, jobId: j.job.id, recipientHash: j.participant.recipientHash, code: randomUUID().replaceAll("-", "").slice(0, 22), targetHash: randomUUID(), targetUrl: "https://shop.test", clickCount: 1 }).returning();
    await db.insert(campaignClickEvents).values({ campaignId: campaign.id, productId: link.productId, linkId: link.id, recipientHash: link.recipientHash, clickedAt: at });
    return link;
  }
  return { db, user, account, campaign, job, click };
}

describe("campaign aggregate reports and immutable revisions", () => {
  beforeEach(async () => { await resetDb(); await seedCampaignConfig(); });

  it("counts logical DM outcomes, distinct delivered recipients, crawler-filtered click facts and uncertain clicks separately", async () => {
    const w = await world(); const known = await w.job("instant_link", "sent", "known-person");
    await w.job("follow_link", "sent", "known-person"); await w.job("follow_request", "sent");
    const unknown = await w.job("instant_link", "unknown"); await w.job("instant_link", "expired"); await w.job("instant_link", "failed"); await w.job("instant_link", "waiting"); await w.job("public_reply", "sent");
    const link = await w.click(known); await w.db.insert(campaignClickEvents).values({ campaignId: w.campaign.id, productId: link.productId, linkId: link.id, recipientHash: link.recipientHash, clickedAt: now });
    const [option] = await w.db.insert(campaignProducts).values({ campaignId: w.campaign.id, name: "세트", option: "2개", originalUrl: "https://shop.test/set" }).returning();
    await w.click(known, option.id); await w.click(unknown);
    const report = await getCampaignReport(w.db, w.user.id, w.campaign.id, now);
    expect(report.live.metrics).toMatchObject({ dmSent: 3, dmFailed: 1, dmExpired: 1, dmPending: 1, dmUnknown: 1, linkRecipients: 1, uniqueClicks: 2, totalClicks: 4, confirmedUniqueClicks: 1, uncertainUniqueClicks: 1, ctrPercent: 100 });
    expect(report.live.products.reduce((sum, p) => sum + p.uniqueClicks, 0)).toBe(3);
    expect(report.live.hourly).toEqual([{ hour: 9, clicks: 4 }]);
    for (const privateValue of ["known-person", "private-username", "private-comment", known.participant.recipientHash, w.user.id, w.account.igUserId, known.job.id]) expect(JSON.stringify(report.live)).not.toContain(privateValue);
    expect((await w.db.select().from(dmJobs).where(eq(dmJobs.id, unknown.job.id)))[0].status).toBe("unknown");
  });

  it("uses unavailable CTR at zero deliveries and pins snapshots before later clicks and order edits", async () => {
    const w = await world(); expect((await getCampaignReport(w.db, w.user.id, w.campaign.id, now)).live.metrics.ctrPercent).toBeNull();
    const sent = await w.job("instant_link", "sent"); await w.click(sent);
    await saveManualOrders(w.db, w.user.id, { campaignId: w.campaign.id, requestId: randomUUID(), expectedRevision: 0, orderCount: 5, revenueKrw: 120_000 }, now);
    const requestId = randomUUID(); const snapshot = await createReportSnapshot(w.db, w.user.id, w.campaign.id, { requestId, now });
    await w.click(sent, undefined, later(1000));
    await saveManualOrders(w.db, w.user.id, { campaignId: w.campaign.id, requestId: randomUUID(), expectedRevision: 1, orderCount: 7, revenueKrw: 170_000 }, later(1000));
    expect(await createReportSnapshot(w.db, w.user.id, w.campaign.id, { requestId, now: later(2000) })).toEqual(snapshot);
    expect((await getOwnedReportSnapshot(w.db, w.user.id, w.campaign.id, snapshot.id)).data.metrics).toMatchObject({ totalClicks: 1, orders: 5, revenueKrw: 120_000 });
    expect((await getCampaignReport(w.db, w.user.id, w.campaign.id, later(2000))).live.metrics).toMatchObject({ totalClicks: 2, orders: 7, revenueKrw: 170_000 });
    expect(await w.db.select().from(reportSnapshots)).toHaveLength(1);
  });

  it("serializes cumulative order edits, keeps their audit trail and rejects request reuse with different totals", async () => {
    const w = await world(); const input = { campaignId: w.campaign.id, requestId: randomUUID(), expectedRevision: 0, orderCount: 1, revenueKrw: 10 };
    expect(await Promise.all([saveManualOrders(w.db, w.user.id, input, now), saveManualOrders(w.db, w.user.id, input, now)])).toEqual([1, 1]);
    await expect(saveManualOrders(w.db, w.user.id, { ...input, revenueKrw: 20 }, now)).rejects.toMatchObject({ code: "request_conflict" });
    await expect(saveManualOrders(w.db, w.user.id, { ...input, requestId: randomUUID() }, now)).rejects.toMatchObject({ code: "conflict" });
    await expect(saveManualOrders(w.db, w.user.id, { ...input, revenueKrw: 1.5 }, now)).rejects.toMatchObject({ code: "validation" });
    expect(await w.db.select().from(manualOrderEntries)).toHaveLength(1);
  });

  it("creates close/final report requests atomically, resumes them after a restart and never duplicates their snapshots", async () => {
    const w = await world(); await w.job("instant_link", "unknown");
    let closed: Campaign = await transitionCampaign(w.db, w.user.id, w.campaign.id, "closed", { now, expectedVersion: w.campaign.version, requestId: randomUUID(), reason: "fixture" });
    expect(await w.db.select().from(campaignReportRequests)).toHaveLength(1);
    await Promise.all([processCampaignReports(w.db, now), processCampaignReports(w.db, now)]);
    await processCampaignReports(w.db, later(60_000));
    expect(await w.db.select().from(reportSnapshots)).toHaveLength(1);
    await expect(transitionCampaign(w.db, w.user.id, w.campaign.id, "settled", { now: later(60_000), expectedVersion: closed.version, requestId: randomUUID(), reason: "fixture" })).rejects.toMatchObject({ code: "incomplete" });
    closed = await transitionCampaign(w.db, w.user.id, w.campaign.id, "settled", { now: later(60_000), expectedVersion: closed.version, requestId: randomUUID(), reason: "reviewed", acknowledgeIncomplete: true });
    await processCampaignReports(w.db, later(60_000));
    expect(await w.db.select().from(reportSnapshots)).toHaveLength(2);
    expect((await w.db.select().from(reportSnapshots).where(eq(reportSnapshots.finalized, true)))[0].data.metrics.dmUnknown).toBe(1);
    const order = { campaignId: closed.id, expectedRevision: 0, requestId: randomUUID(), orderCount: 2, revenueKrw: 400 };
    await expect(saveManualOrders(w.db, w.user.id, order, later(120_000))).rejects.toMatchObject({ code: "finalized" });
    await saveManualOrders(w.db, w.user.id, { ...order, reviseFinal: true }, later(120_000)); await processCampaignReports(w.db, later(120_000));
    expect(await w.db.select().from(reportSnapshots)).toHaveLength(3);
  });

  it("compares the same elapsed observation period of the preceding closed campaign", async () => {
    const w = await world();
    const [previous] = await w.db.insert(campaigns).values({ userId: w.user.id, igAccountId: w.account.id, title: "이전 공구", brand: "", slug: randomUUID(), status: "closed", publishedAt: new Date(+now - 10 * 86_400_000), openedAt: new Date(+now - 9 * 86_400_000), closedAt: new Date(+now - 8 * 86_400_000), openAt: new Date(+now - 9 * 86_400_000), closeAt: new Date(+now - 8 * 86_400_000), notificationKeywords: ["알림"], linkKeywords: ["링크"], templates: w.campaign.templates, hourlyRate: 400 }).returning();
    await w.db.insert(manualOrderEntries).values([{ campaignId: previous.id, revision: 1, requestId: randomUUID(), orderCount: 3, revenueKrw: 100, createdAt: new Date(+now - 10 * 86_400_000 + 1000) }, { campaignId: previous.id, revision: 2, requestId: randomUUID(), orderCount: 100, revenueKrw: 10000, createdAt: new Date(+now - 8 * 86_400_000) }]);
    await saveManualOrders(w.db, w.user.id, { campaignId: w.campaign.id, expectedRevision: 0, requestId: randomUUID(), orderCount: 6, revenueKrw: 200 }, later(1000));
    const report = await getCampaignReport(w.db, w.user.id, w.campaign.id, later(3_600_000));
    expect(report.live.comparison?.observedDurationMs).toBe(3_600_000);
    expect(report.live.comparison?.values.find((v) => v.metric === "orders")).toMatchObject({ current: 6, previous: 3, difference: 3, percent: 100 });
  });

  it("enforces ownership and flag OFF, and deletes reports with their campaign", async () => {
    const w = await world(); const other = await createUser(); const snapshot = await createReportSnapshot(w.db, w.user.id, w.campaign.id, { requestId: randomUUID(), now });
    await expect(getOwnedReportSnapshot(w.db, other.id, w.campaign.id, snapshot.id)).rejects.toMatchObject({ code: "not_found" });
    await w.db.update(featureFlags).set({ enabled: false }); await expect(getCampaignReport(w.db, w.user.id, w.campaign.id, now)).rejects.toMatchObject({ code: "not_found" });
    await w.db.delete(campaigns).where(eq(campaigns.id, w.campaign.id)); expect(await w.db.select().from(reportSnapshots)).toHaveLength(0);
  });
});
