import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/instagram/route";
import { getDb, createDb } from "@/server/db/client";
import { campaignDeliveries, campaignParticipants, campaigns, commentEvents, dmJobs, featureFlags, igAccounts, privateReplyClaims } from "@/server/db/schema";
import { decryptSecret } from "@/server/crypto";
import { GraphApiError, GraphNetworkError } from "@/server/instagram/errors";
import { saveCampaign, publishCampaign } from "@/server/campaigns/service";
import { claimCampaignEvents, routeCampaignEvent } from "@/server/campaigns/routing";
import { claimEvents } from "@/server/queue/events";
import { ingestComments } from "@/server/queue/ingest";
import { processCommentEvent } from "@/server/pipeline/process-comment";
import { CAMPAIGN_NOW, campaignWorld, seedCampaignConfig } from "../helpers/campaigns";
import { createAutomation, createIgAccount, createUser, setPlan } from "../helpers/factories";
import { resetDb } from "../helpers/db";

async function world() {
  const user = await createUser(); const account = await createIgAccount(user.id, { nextReplyAt: CAMPAIGN_NOW }); await setPlan(user.id, "pro");
  const { graph, input } = campaignWorld(account);
  const campaign = await saveCampaign(getDb(), user.id, { ...input, excludedKeywords: ["광고"] }, { graph, decrypt: decryptSecret, now: CAMPAIGN_NOW, appUrl: "https://app.test" });
  await publishCampaign(getDb(), user.id, campaign.id, true, CAMPAIGN_NOW);
  const comment = (id = "900001", person = "90000001", text = "알림", createdAt = new Date("2026-10-20T00:00:00Z")) => {
    graph.comments[id] = { id, mediaId: input.mediaIds[0], authorId: person, createdAt };
    return { igUserId: account.igUserId, commentId: id, mediaId: input.mediaIds[0], mediaProductType: "FEED", parentCommentId: null, commenterIgId: person, commenterUsername: "fixture", text };
  };
  const deps = { db: getDb(), graph, now: () => CAMPAIGN_NOW, decryptToken: decryptSecret, hashKey: "local-test-hash-key" };
  const route = async (now = CAMPAIGN_NOW) => Promise.all((await claimCampaignEvents(getDb(), { batch: 20, now })).map((event) => routeCampaignEvent({ ...deps, now: () => now }, event)));
  return { user, account, graph, campaign, input, comment, deps, route };
}

describe("durable campaign routing", () => {
  beforeEach(async () => { await resetDb(); await seedCampaignConfig(); });
  afterEach(() => vi.useRealTimers());

  it("ingests a signed webhook three times, creates one public/held-DM pair and never calls Meta from the webhook", async () => {
    const w = await world(); const c = w.comment();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(CAMPAIGN_NOW);
    const body = JSON.stringify({ object: "instagram", entry: [{ id: w.account.igUserId, time: 1, changes: [{ field: "comments", value: { id: c.commentId, text: c.text, from: { id: c.commenterIgId }, media: { id: c.mediaId } } }] }] });
    const signature = `sha256=${createHmac("sha256", process.env.IG_APP_SECRET!).update(body).digest("hex")}`;
    for (let i = 0; i < 3; i++) expect((await POST(new Request("http://localhost/api/webhooks/instagram", { method: "POST", body, headers: { "x-hub-signature-256": signature } }))).status).toBe(200);
    // Actual webhook receipt time is independent of entry.time; use its stored runAt for the worker.
    const [event] = await getDb().select().from(commentEvents);
    expect(event.stateAtReceipt).toBe("teaser");
    expect(await claimEvents(getDb(), { batch: 10, now: event.receivedAt })).toHaveLength(0);
    expect(w.graph.commentReads).toBe(0);
    expect(await w.route(event.receivedAt)).toEqual(["routed"]);
    const jobs = await getDb().select().from(dmJobs);
    expect(jobs).toHaveLength(2);
    expect(jobs.find((j) => j.channel === "private_reply")).toMatchObject({ kind: "opening_link", scheduledAt: new Date(w.input.openAt), deadlineAt: new Date("2026-10-26T23:00:00Z"), status: "waiting" });
    expect(w.graph.dms).toHaveLength(0); expect(w.graph.replies).toHaveLength(0);
    expect(await getDb().select().from(privateReplyClaims)).toHaveLength(1);
    expect(await getDb().select().from(campaignDeliveries)).toHaveLength(3);
  });

  it("deduplicates a person across concurrent comments and preserves the jobs through a new DB connection", async () => {
    const w = await world();
    await ingestComments(getDb(), [w.comment("901"), w.comment("902"), w.comment("903")], CAMPAIGN_NOW);
    const results = await w.route();
    expect(results.sort()).toEqual(["duplicate", "duplicate", "routed"]);
    expect(await getDb().select().from(campaignParticipants)).toHaveLength(1);
    expect(await getDb().select().from(dmJobs)).toHaveLength(2);
    const restarted = createDb(process.env.TEST_DATABASE_URL!, { max: 1 });
    try { expect(await restarted.db.select().from(dmJobs)).toHaveLength(2); } finally { await restarted.sql.end(); }
  });

  it("keeps the receive-time state/rules and records effective OPEN when the scheduler is late", async () => {
    const w = await world();
    await ingestComments(getDb(), [w.comment()], CAMPAIGN_NOW);
    await getDb().update(campaigns).set({ notificationKeywords: ["다른말"] });
    expect(await w.route()).toEqual(["routed"]);
    const atOpen = new Date(w.input.openAt);
    await ingestComments(getDb(), [w.comment("904", "other", "링크")], atOpen);
    const [event] = await getDb().select().from(commentEvents).where(eq(commentEvents.commentId, "904"));
    expect(event).toMatchObject({ stateAtReceipt: "open", storedStateAtReceipt: "teaser" });
    await w.route(atOpen);
    expect((await getDb().select().from(dmJobs).where(eq(dmJobs.sourceEventId, event.id))).some((j) => j.kind === "instant_link")).toBe(true);
  });

  it("suppresses campaign exclusions and passes only unrelated keywords to specific legacy automation", async () => {
    const w = await world();
    await createAutomation(w.account, { keywords: ["배송", "광고"], mediaScope: "all" });
    const specific = await createAutomation(w.account, { keywords: ["배송", "광고"], mediaScope: "specific", mediaId: w.input.mediaIds[0] });
    await ingestComments(getDb(), [w.comment("905", "one", "광고 알림"), w.comment("906", "two", "배송")], CAMPAIGN_NOW);
    expect((await w.route()).sort()).toEqual(["excluded", "legacy"]);
    const claimed = await claimEvents(getDb(), { batch: 10, now: CAMPAIGN_NOW });
    expect(claimed).toHaveLength(1); expect(claimed[0].commentId).toBe("906");
    await processCommentEvent({ ...w.deps, random: () => 0, sleep: async () => {}, hourlyLimit: 400, appUrl: "https://app.test" }, claimed[0]);
    expect((await getDb().select().from(commentEvents).where(eq(commentEvents.commentId, "906")))[0].automationId).toBe(specific.id);
    expect(w.graph.dms).toHaveLength(1);
    expect(await getDb().select().from(dmJobs)).toHaveLength(0);
  });

  it("does not reclassify an already captured campaign comment when the flag is turned off", async () => {
    const w = await world(); await createAutomation(w.account, { keywords: ["알림"] });
    await ingestComments(getDb(), [w.comment()], CAMPAIGN_NOW);
    const [leased] = await claimCampaignEvents(getDb(), { batch: 1, now: CAMPAIGN_NOW });
    await getDb().update(featureFlags).set({ enabled: false });
    expect(await routeCampaignEvent(w.deps, leased)).toBe("held");
    expect(await claimEvents(getDb(), { batch: 10, now: CAMPAIGN_NOW })).toHaveLength(0);
    expect(await claimCampaignEvents(getDb(), { batch: 10, now: CAMPAIGN_NOW })).toHaveLength(0);
    await ingestComments(getDb(), [w.comment("907")], CAMPAIGN_NOW);
    expect((await claimEvents(getDb(), { batch: 10, now: CAMPAIGN_NOW }))[0].commentId).toBe("907");
    await getDb().update(featureFlags).set({ enabled: true });
    expect(await w.route()).toEqual(["routed"]);
  });

  it("reclaims crashed routers and fences out stale metadata responses", async () => {
    const w = await world(); await ingestComments(getDb(), [w.comment()], CAMPAIGN_NOW);
    const [old] = await claimCampaignEvents(getDb(), { batch: 1, now: CAMPAIGN_NOW });
    const later = new Date(CAMPAIGN_NOW.getTime() + 61_000);
    const [newer] = await claimCampaignEvents(getDb(), { batch: 1, now: later });
    expect(await routeCampaignEvent({ ...w.deps, now: () => later }, newer)).toBe("routed");
    expect(await routeCampaignEvent(w.deps, old)).toBe("stale_lease");
    expect(await getDb().select().from(dmJobs)).toHaveLength(2);
  });

  it("retries metadata read failures finitely, refuses missing/foreign/future timestamps, and never guesses receipt time", async () => {
    const w = await world(); await ingestComments(getDb(), [w.comment()], CAMPAIGN_NOW);
    w.graph.commentError = new GraphNetworkError("network contains secret value");
    let now = CAMPAIGN_NOW;
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(await w.route(now)).toEqual([attempt < 5 ? "metadata_retry" : "metadata_failed"]);
      now = (await getDb().select().from(commentEvents))[0].runAt;
    }
    const [failed] = await getDb().select().from(commentEvents);
    expect(failed.errorMessage).not.toContain("secret"); expect(failed.commentCreatedAt).toBeNull();
    w.graph.commentError = null;
    for (const [index, createdAt] of [null, new Date("2027-01-01")].entries()) {
      const c = w.comment(`bad${index}`); w.graph.comments[c.commentId].createdAt = createdAt;
      await ingestComments(getDb(), [c], CAMPAIGN_NOW); expect(await w.route()).toEqual([createdAt ? "metadata_failed" : "metadata_retry"]);
    }
    expect(await getDb().select().from(dmJobs)).toHaveLength(0);
  });

  it("holds captured comments until token reauthentication instead of discarding them", async () => {
    const w = await world(); await ingestComments(getDb(), [w.comment()], CAMPAIGN_NOW);
    w.graph.commentError = new GraphApiError("expired token", 400, 190);
    expect(await w.route()).toEqual(["reauth_required"]);
    expect(await claimCampaignEvents(getDb(), { batch: 10, now: CAMPAIGN_NOW })).toHaveLength(0);
    w.graph.commentError = null;
    await getDb().update(igAccounts).set({ status: "active" }).where(eq(igAccounts.id, w.account.id));
    expect(await w.route()).toEqual(["routed"]);
  });

  it("cascades operational jobs/identities on account deletion", async () => {
    const w = await world(); await ingestComments(getDb(), [w.comment()], CAMPAIGN_NOW); await w.route();
    await getDb().delete(igAccounts).where(eq(igAccounts.id, w.account.id));
    for (const table of [dmJobs, campaignParticipants, campaignDeliveries, privateReplyClaims]) expect(await getDb().select().from(table)).toHaveLength(0);
  });

  it("does not create private replies for already expired comments and rejects cross-account job references", async () => {
    const w = await world(); await ingestComments(getDb(), [w.comment("old", "old-person", "알림", new Date("2026-10-01"))], CAMPAIGN_NOW); await w.route();
    const [job] = await getDb().select().from(dmJobs);
    expect(job.status).toBe("expired");
    const other = await createIgAccount(w.user.id);
    await expect(getDb().update(dmJobs).set({ igAccountId: other.id }).where(eq(dmJobs.id, job.id))).rejects.toThrow();
    expect(await getDb().select().from(dmJobs).where(and(eq(dmJobs.status, "waiting"), eq(dmJobs.channel, "private_reply")))).toHaveLength(0);
    await ingestComments(getDb(), [w.comment("fresh", "old-person")], CAMPAIGN_NOW);
    expect(await w.route()).toEqual(["routed"]);
    expect(await getDb().select().from(dmJobs).where(and(eq(dmJobs.status, "waiting"), eq(dmJobs.channel, "private_reply")))).toHaveLength(1);
    expect(await getDb().select().from(campaignParticipants)).toHaveLength(1);
  });

  it("retains a person's reservation after an attempted or unknown send", async () => {
    const w = await world(); await ingestComments(getDb(), [w.comment()], CAMPAIGN_NOW); await w.route();
    await getDb().update(dmJobs).set({ status: "unknown", attempts: 1 }).where(eq(dmJobs.channel, "private_reply"));
    await ingestComments(getDb(), [w.comment("another")], CAMPAIGN_NOW);
    expect(await w.route()).toEqual(["duplicate"]);
    expect(await getDb().select().from(dmJobs)).toHaveLength(2);
  });
});
