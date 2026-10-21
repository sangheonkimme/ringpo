import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { accountSendControls, campaignNotificationOutbox, campaigns, conversationStates, dmJobs, featureFlags, privateReplyClaims, sendAttempts, sendBuckets } from "@/server/db/schema";
import { decryptSecret } from "@/server/crypto";
import { GraphApiError, GraphNetworkError } from "@/server/instagram/errors";
import { dispatchCampaignJob, invokePreparedSend, prepareCampaignSend, settleCampaignSend, type DispatchDeps } from "@/server/campaigns/dispatch";
import { claimCampaignJobs, expireCampaignJobs, recoverCampaignJobs } from "@/server/campaigns/jobs";
import { claimCampaignEvents, routeCampaignEvent } from "@/server/campaigns/routing";
import { saveCampaign, publishCampaign, transitionCampaign } from "@/server/campaigns/service";
import { ingestComments } from "@/server/queue/ingest";
import { CAMPAIGN_NOW, campaignWorld, seedCampaignConfig } from "../helpers/campaigns";
import { createIgAccount, createUser, setPlan } from "../helpers/factories";
import { resetDb } from "../helpers/db";

async function world(count = 1, rate = 400, teaser = false) {
  const db = getDb(); const user = await createUser(); const account = await createIgAccount(user.id); await setPlan(user.id, "pro");
  const { graph, input } = campaignWorld(account);
  const campaign = await saveCampaign(db, user.id, { ...input, hourlyRate: rate }, { graph, decrypt: decryptSecret, now: CAMPAIGN_NOW, appUrl: "https://app.test" });
  let now = teaser ? CAMPAIGN_NOW : new Date(input.openAt);
  await publishCampaign(db, user.id, campaign.id, true, now);
  const events = Array.from({ length: count }, (_, i) => {
    const commentId = `comment-${i}`; const commenterIgId = `person-${i}`;
    graph.comments[commentId] = { id: commentId, authorId: commenterIgId, mediaId: input.mediaIds[0], createdAt: new Date(CAMPAIGN_NOW.getTime() - i * 1000) };
    return { igUserId: account.igUserId, commentId, commenterIgId, commenterUsername: "fixture", mediaId: input.mediaIds[0], mediaProductType: "FEED", parentCommentId: null, text: teaser ? "알림" : "링크" };
  });
  await ingestComments(db, events, now);
  for (const event of await claimCampaignEvents(db, { batch: count, now })) await routeCampaignEvent({ db, graph, now: () => now, decryptToken: decryptSecret, hashKey: "fixture" }, event);
  // The renderer reads latest templates inside the send transaction; link/follow rendering is tested separately.
  const deps: DispatchDeps = { db, graph, decryptToken: decryptSecret, random: () => 0, clock: async () => now,
    render: async (_db, { campaign, job }) => ({ kind: "text", text: job.channel === "public_reply" ? campaign.templates.open.publicReplies[0] : campaign.templates.open.privateReply }) };
  const claim = () => claimCampaignJobs(db, { batch: 10, now, workerId: "test" });
  const tick = async () => Promise.all((await claim()).map((job) => dispatchCampaignJob(deps, job)));
  return { db, user, account, campaign, graph, deps, claim, tick, now: () => now, advance: (ms: number) => { now = new Date(now.getTime() + ms); }, setNow: (value: Date) => { now = value; } };
}

describe("campaign send dispatch", () => {
  beforeEach(async () => { await resetDb(); await seedCampaignConfig(); });

  it("rechecks a concurrent OFF->ON observation under the account lock before granting a send permit", async () => {
    const w = await world(); await w.tick(); w.advance(3000);
    w.deps.render = async (tx) => {
      await tx.update(accountSendControls).set({ lastObservedEnabled: false }).where(eq(accountSendControls.igAccountId, w.account.id));
      return { kind: "text", text: "공구 링크" };
    };
    const job = (await w.claim()).find((row) => row.channel === "private_reply")!;
    expect(await dispatchCampaignJob(w.deps, job)).toBe("deferred"); expect(w.graph.dms).toHaveLength(0);
    const [control] = await w.db.select().from(accountSendControls); expect(control.warmupUntil!.getTime()).toBe(w.now().getTime() + 3_602_000);
  });

  it("waits durably for jitter, sends by earliest comment deadline, uses latest template and never repeats on redelivery", async () => {
    const w = await world(2);
    expect((await w.tick()).sort()).toEqual(["waiting", "waiting"]); expect(w.graph.dms).toHaveLength(0);
    const [latest] = await w.db.select().from(campaigns);
    await w.db.update(campaigns).set({ templates: { ...latest.templates, open: { ...latest.templates.open, privateReply: "수정한 링크 안내" } }, version: latest.version + 1 });
    w.advance(3000);
    const jobs = await w.claim(); expect(jobs.find((j) => j.channel === "private_reply")?.commentCreatedAt).toEqual(new Date(CAMPAIGN_NOW.getTime() - 1000));
    await Promise.all(jobs.map((j) => dispatchCampaignJob(w.deps, j)));
    expect(w.graph.dms).toHaveLength(1); expect(w.graph.dms[0].message.text).toBe("수정한 링크 안내");
    expect(await dispatchCampaignJob(w.deps, jobs[0])).toBe("stale_lease");
    expect(await w.tick()).toEqual([]);
    w.advance(9000); await w.tick(); expect(w.graph.dms).toHaveLength(2);
    expect((await w.db.select().from(sendAttempts)).every((a) => a.state === "accepted" && a.payload === null)).toBe(true);
  });

  it("keeps teaser DMs queued, then manual early OPEN moves the same durable job", async () => {
    const w = await world(1, 400, true);
    await w.tick(); w.advance(3000); await w.tick(); expect(w.graph.dms).toHaveLength(0); expect(w.graph.replies).toHaveLength(1);
    const [current] = await w.db.select().from(campaigns);
    await transitionCampaign(w.db, w.user.id, current.id, "open", { now: w.now(), expectedVersion: current.version, requestId: "early", reason: "먼저 오픈" });
    await w.tick(); w.advance(3000); await w.tick(); expect(w.graph.dms).toHaveLength(1);
  });

  it("recovers an unstarted lease but keeps writes with lost responses unknown across restart", async () => {
    const w = await world(); await w.tick(); w.advance(3000);
    const first = (await w.claim()).find((j) => j.channel === "private_reply")!;
    w.advance(61_000); expect((await recoverCampaignJobs(w.db, w.now())).waiting).toBeGreaterThan(0);
    expect(await dispatchCampaignJob(w.deps, first)).toBe("stale_lease");
    const next = (await w.claim()).find((j) => j.channel === "private_reply")!;
    const prepared = await prepareCampaignSend(w.deps, next); if (typeof prepared === "string") throw new Error(prepared);
    const result = await invokePreparedSend(prepared, w.graph); expect(result.state).toBe("accepted");
    w.advance(61_000); expect((await recoverCampaignJobs(w.db, w.now())).unknown).toBe(1);
    expect(await settleCampaignSend(w.deps, prepared, result)).toBe("stale_lease");
    expect((await w.db.select().from(sendAttempts))[0]).toMatchObject({ state: "unknown", lateResult: { state: "accepted" } });
    expect((await w.db.select().from(privateReplyClaims))[0].state).toBe("unknown");
    await w.tick(); expect(w.graph.dms).toHaveLength(1);
  });

  it("does not call Meta when the short durable permit expires before invocation", async () => {
    const w = await world(); await w.tick(); w.advance(3000);
    const job = (await w.claim()).find((j) => j.channel === "private_reply")!;
    const prepared = await prepareCampaignSend(w.deps, job); if (typeof prepared === "string") throw new Error(prepared);
    prepared.permitClockStarted -= 2100;
    const result = await invokePreparedSend(prepared, w.graph);
    expect(result.state).toBe("not_invoked"); expect(await settleCampaignSend(w.deps, prepared, result)).toBe("waiting");
    expect(w.graph.dms).toHaveLength(0);
    expect((await w.db.select().from(dmJobs).where(eq(dmJobs.id, job.id)))[0].attempts).toBe(0);
  });

  it.each([new GraphNetworkError("private token"), new GraphApiError("server", 503, 2)])("never retries ambiguous network/server writes", async (error) => {
    const w = await world(); w.graph.dmError = () => error;
    await w.tick(); w.advance(3000); expect(await w.tick()).toContain("unknown");
    const [job] = await w.db.select().from(dmJobs).where(eq(dmJobs.channel, "private_reply"));
    expect(job.status).toBe("unknown"); expect(job.lastErrorCode).not.toContain("token");
    w.advance(600_000); await w.tick(); expect((await w.db.select().from(sendAttempts).where(eq(sendAttempts.channel, "private_reply")))).toHaveLength(1);
  });

  it("does not turn a 5xx format-looking error into a second private reply", async () => {
    const w = await world();
    w.deps.render = async () => ({ kind: "button", text: "fixture", buttonTitle: "상품", url: "https://example.com" });
    w.graph.dmError = () => new GraphApiError("uncertain format", 503, 100, 2534015);
    await w.tick(); w.advance(3000); expect(await w.tick()).toContain("unknown");
    expect((await w.db.select().from(dmJobs).where(eq(dmJobs.channel, "private_reply")))[0]).toMatchObject({ status: "unknown", messageFormat: "auto" });
  });

  it("pauses after five rate errors, persists one seller notification and uses half-open probes", async () => {
    const w = await world(6); w.graph.replyError = () => new GraphApiError("rate", 429, 613, undefined, 10_000);
    await w.tick(); w.advance(3000);
    for (let i = 0; i < 5; i++) { await w.tick(); w.advance(61_000); }
    const [bucket] = await w.db.select().from(sendBuckets).where(eq(sendBuckets.channel, "public_reply"));
    expect(bucket.errorStreak).toBe(5); expect(bucket.pausedUntil!.getTime()).toBeGreaterThan(w.now().getTime());
    expect(await w.db.select().from(campaignNotificationOutbox)).toHaveLength(1);
    w.setNow(bucket.pausedUntil!); await w.tick();
    expect(await w.db.select().from(campaignNotificationOutbox)).toHaveLength(2);
    const [again] = await w.db.select().from(sendBuckets).where(eq(sendBuckets.channel, "public_reply"));
    w.graph.replyError = null; w.setNow(again.pausedUntil!); await w.tick();
    expect((await w.db.select().from(sendBuckets).where(eq(sendBuckets.channel, "public_reply")))[0].pausedUntil).toBeNull();
  });

  it("manual pause and flag off block new calls while deadlines still expire", async () => {
    const w = await world(); await w.tick(); w.advance(3000);
    await w.db.update(accountSendControls).set({ manualPaused: true }); expect(await w.claim()).toEqual([]);
    await w.db.update(accountSendControls).set({ manualPaused: false }); const jobs = await w.claim();
    await w.db.update(featureFlags).set({ enabled: false });
    for (const job of jobs) expect(await dispatchCampaignJob(w.deps, job)).toBe("held");
    expect(w.graph.dms).toHaveLength(0); expect(w.graph.replies).toHaveLength(0);
    w.advance(7 * 86_400_000); expect(await expireCampaignJobs(w.db, w.now())).toBe(2);
  });

  it("stops public replies on repeated DM errors and a late in-flight public success cannot clear that stop", async () => {
    const w = await world(); await w.tick(); w.advance(3000);
    const jobs = await w.claim();
    const pub = await prepareCampaignSend(w.deps, jobs.find((j) => j.channel === "public_reply")!);
    const dm = await prepareCampaignSend(w.deps, jobs.find((j) => j.channel === "private_reply")!);
    if (typeof pub === "string" || typeof dm === "string") throw new Error("Expected both permits");
    await w.db.update(sendBuckets).set({ errorStreak: 4, streakStartedAt: w.now() }).where(eq(sendBuckets.channel, "private_reply"));
    w.graph.dmError = () => new GraphApiError("rate", 429, 613);
    await settleCampaignSend(w.deps, dm, await invokePreparedSend(dm, w.graph));
    expect(await settleCampaignSend(w.deps, pub, await invokePreparedSend(pub, w.graph))).toBe("sent");
    const [bucket] = await w.db.select().from(sendBuckets).where(eq(sendBuckets.channel, "public_reply"));
    expect(bucket.pausedUntil).toEqual(new Date(w.now().getTime() + 6 * 3_600_000));
  });

  it("enforces user-initiated 24h messaging windows and human handoff at send time", async () => {
    const w = await world();
    const [job] = await w.db.select().from(dmJobs).where(eq(dmJobs.channel, "private_reply"));
    await w.db.update(dmJobs).set({ channel: "message", kind: "faq" }).where(eq(dmJobs.id, job.id));
    await w.db.insert(conversationStates).values({ igAccountId: w.account.id, senderId: "person-0", lastUserInteractionAt: new Date(w.now().getTime() - 86_400_000) });
    expect(await w.tick()).toContain("expired"); expect(w.graph.messages).toHaveLength(0);
  });

  it("serializes competing workers per account/channel", async () => {
    const w = await world(4); await w.tick(); w.advance(3000);
    const batches = await Promise.all(Array.from({ length: 3 }, () => w.claim()));
    const claimed = batches.flat(); expect(claimed).toHaveLength(2);
    await Promise.all(claimed.map((j) => dispatchCampaignJob(w.deps, j)));
    expect(w.graph.dms).toHaveLength(1); expect(w.graph.replies).toHaveLength(1);
    expect((await w.db.select().from(sendBuckets).where(and(eq(sendBuckets.igAccountId, w.account.id), eq(sendBuckets.channel, "private_reply"))))[0].leaseOwner).toBeNull();
  });
});
