import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { accountSendControls, automations, commentEvents, deliveries, featureFlags, igAccounts, privateReplyClaims, sendAttempts, sendBuckets, usageCounters } from "@/server/db/schema";
import { decryptSecret } from "@/server/crypto";
import { GraphApiError, GraphNetworkError } from "@/server/instagram/errors";
import { processWithSharedBudget } from "@/server/pipeline/shared-budget";
import { claimEvents, LEGACY_EVENT_LEASE_MS } from "@/server/queue/events";
import { legacySendGuard } from "@/server/campaigns/legacy-guard";
import { dispatchCampaignJob } from "@/server/campaigns/dispatch";
import { claimCampaignJobs } from "@/server/campaigns/jobs";
import { claimCampaignEvents, routeCampaignEvent } from "@/server/campaigns/routing";
import { publishCampaign, saveCampaign } from "@/server/campaigns/service";
import { ingestComments } from "@/server/queue/ingest";
import { DEFAULT_CAMPAIGN_TEMPLATES } from "@/lib/campaign-schema";
import { CAMPAIGN_NOW, campaignWorld, seedCampaignConfig } from "../helpers/campaigns";
import { createAutomation, createEvent, createIgAccount, createUser, setPlan } from "../helpers/factories";
import { FakeGraphClient } from "../helpers/fake-graph";
import { resetDb } from "../helpers/db";

async function world(enabled = true, replyEnabled = true) {
  await seedCampaignConfig(enabled);
  const db = getDb(); const owner = await createUser(); const account = await createIgAccount(owner.id, { nextReplyAt: CAMPAIGN_NOW });
  await setPlan(owner.id, "pro"); const automation = await createAutomation(account, { replyEnabled }); const graph = new FakeGraphClient();
  let now = CAMPAIGN_NOW; let sleeps = 0;
  const deps = { db, graph, now: () => now, clock: async () => now, random: () => 0, sleep: async () => { sleeps++; }, appUrl: "https://ringpo.test", hourlyLimit: 700, decryptToken: decryptSecret };
  const event = async () => {
    const row = await createEvent(account, { commenterIgId: `person-${Math.random()}`, receivedAt: now, runAt: now });
    graph.comments[row.commentId] = { id: row.commentId, mediaId: row.mediaId, authorId: row.commenterIgId, createdAt: now };
    return row;
  };
  const claim = async () => (await claimEvents(db, { batch: 1, now }))[0];
  const tick = async () => { const item = await claim(); return item ? processWithSharedBudget(deps, item) : "idle"; };
  return { db, owner, account, automation, graph, deps, event, claim, tick, now: () => now, advance: (ms: number) => { now = new Date(now.getTime() + ms); }, sleeps: () => sleeps };
}

describe("legacy and campaign shared send budgets", () => {
  beforeEach(resetDb);

  it("keeps never-enabled flag-OFF automation behavior and creates no new budgets or attempts", async () => {
    const w = await world(false); await w.event();
    expect(await w.tick()).toBe("succeeded"); expect(w.graph.replies).toHaveLength(1); expect(w.graph.dms).toHaveLength(1);
    expect(w.graph.commentReads).toBe(0); expect(await w.db.select().from(accountSendControls)).toHaveLength(0); expect(await w.db.select().from(sendAttempts)).toHaveLength(0);
    expect(w.graph.dms[0].message).toMatchObject({ kind: "button", buttonTitle: "구매하기" });
  });

  it("persists initial jitter, uses separate channel budgets, and records acceptance with local delivery state", async () => {
    const w = await world(); const event = await w.event();
    expect(await w.tick()).toBe("deferred"); expect(w.graph.dms).toHaveLength(0); w.advance(3000);
    expect(await w.tick()).toBe("succeeded"); expect(w.graph.replies).toHaveLength(1); expect(w.graph.dms).toHaveLength(1); expect(w.sleeps()).toBe(0);
    const attempts = await w.db.select().from(sendAttempts); expect(attempts).toHaveLength(2); expect(attempts.every((row) => row.state === "accepted" && row.payload === null)).toBe(true);
    const [stored] = await w.db.select().from(commentEvents).where(eq(commentEvents.id, event.id));
    expect(stored).toMatchObject({ status: "succeeded", replyStatus: "sent", dmStatus: "sent", sendLeaseVersion: 2 });
    expect(stored.commentCreatedAt).toEqual(CAMPAIGN_NOW); expect((await w.db.select().from(privateReplyClaims))[0].state).toBe("sent");
    expect((await w.db.select().from(usageCounters))[0].dmCount).toBe(1);
  });

  it("shares the account token bucket with other senders instead of allocating another private-reply allowance", async () => {
    const w = await world(true, false); await w.event(); await w.tick(); w.advance(3000);
    const next = new Date(w.now().getTime() + 9000);
    await w.db.update(sendBuckets).set({ tokens: 0, refilledAt: w.now(), nextEligibleAt: next }).where(eq(sendBuckets.channel, "private_reply"));
    expect(await w.tick()).toBe("deferred"); expect(w.graph.dms).toHaveLength(0); w.advance(9000);
    expect(await w.tick()).toBe("succeeded"); expect(w.graph.dms).toHaveLength(1);
  });

  it("runs campaign and legacy sends on the same account and never doubles its private-reply budget", async () => {
    const w = await world(true, false); const data = campaignWorld(w.account); Object.assign(w.graph.media, data.graph.media);
    const campaign = await saveCampaign(w.db, w.owner.id, { ...data.input, openAt: w.now().toISOString(), templates: { ...DEFAULT_CAMPAIGN_TEMPLATES, open: { ...DEFAULT_CAMPAIGN_TEMPLATES.open, publicReplies: [] } } }, { graph: w.graph, decrypt: decryptSecret, now: w.now(), appUrl: w.deps.appUrl });
    await publishCampaign(w.db, w.owner.id, campaign.id, false, w.now());
    const comment = { igUserId: w.account.igUserId, commentId: "campaign-comment", mediaId: data.input.mediaIds[0], commenterIgId: "campaign-person", commenterUsername: null, parentCommentId: null, mediaProductType: "FEED", text: "링크" };
    w.graph.comments[comment.commentId] = { id: comment.commentId, mediaId: comment.mediaId, authorId: comment.commenterIgId, createdAt: w.now() };
    await ingestComments(w.db, [comment], w.now());
    for (const event of await claimCampaignEvents(w.db, { batch: 10, now: w.now() })) await routeCampaignEvent({ db: w.db, graph: w.graph, now: w.now, decryptToken: decryptSecret, hashKey: "fixture" }, event);
    const campaignTick = async () => {
      for (const job of await claimCampaignJobs(w.db, { batch: 10, now: w.now(), workerId: "mixed" })) await dispatchCampaignJob({ ...w.deps, render: async () => ({ kind: "text", text: "공구 링크" }) }, job);
    };
    await campaignTick(); w.advance(3000); await campaignTick(); expect(w.graph.dms).toHaveLength(1);
    await w.event(); await w.tick(); w.advance(3000); expect(await w.tick()).toBe("deferred"); expect(w.graph.dms).toHaveLength(1);
    w.advance(6000); expect(await w.tick()).toBe("succeeded"); expect(w.graph.dms).toHaveLength(2);
    const calls = (await w.db.select().from(sendAttempts)).sort((a,b) => a.startedAt.getTime()-b.startedAt.getTime());
    expect(calls.map((row) => row.campaignId)).toEqual([campaign.id, null]); expect(calls[1].startedAt.getTime()-calls[0].startedAt.getTime()).toBeGreaterThanOrEqual(9000);
  });

  it("holds an ambiguous write for review without releasing person/quota reservations or retrying after restart", async () => {
    const w = await world(true, false); const event = await w.event();
    const original = w.graph.sendPrivateReply.bind(w.graph);
    w.graph.sendPrivateReply = async (...args) => { await original(...args); throw new GraphNetworkError("connection lost after Meta accepted"); };
    await w.tick(); w.advance(3000); expect(await w.tick()).toBe("send_unknown");
    expect(w.graph.dms).toHaveLength(1); expect((await w.db.select().from(sendAttempts))[0].state).toBe("unknown");
    expect((await w.db.select().from(privateReplyClaims))[0].state).toBe("unknown"); expect(await w.db.select().from(deliveries)).toHaveLength(1);
    expect((await w.db.select().from(usageCounters))[0].dmCount).toBe(1);
    w.advance(600_000); expect(await w.tick()).toBe("idle"); expect(w.graph.dms).toHaveLength(1);
    expect((await w.db.select().from(commentEvents).where(eq(commentEvents.id, event.id)))[0].status).toBe("send_unknown");
  });

  it("sends an eligible DM while the public channel waits and resumes only the public reply later", async () => {
    const w = await world(); await w.event(); await w.tick(); w.advance(3000);
    const later = new Date(w.now().getTime() + 60_000);
    await w.db.update(sendBuckets).set({ nextEligibleAt: later }).where(eq(sendBuckets.channel, "public_reply"));
    expect(await w.tick()).toBe("deferred"); expect(w.graph.dms).toHaveLength(1); expect(w.graph.replies).toHaveLength(0);
    w.advance(60_000); expect(await w.tick()).toBe("succeeded"); expect(w.graph.dms).toHaveLength(1); expect(w.graph.replies).toHaveLength(1);
  });

  it("keeps an off-transition budget until one hour after the last shared write, including continuing traffic", async () => {
    const w = await world(true, false); await w.event(); await w.tick(); w.advance(3000); await w.tick();
    await w.db.update(featureFlags).set({ enabled: false }); w.advance(3_590_000);
    await w.event(); await w.tick(); w.advance(3000); expect(await w.tick()).toBe("succeeded");
    w.advance(20_000); expect((await legacySendGuard(w.db, w.account.id, w.now())).guarded).toBe(true);
    const [control] = await w.db.select().from(accountSendControls); expect(control.safetyUntil!.getTime()).toBeGreaterThan(w.now().getTime() + 3_500_000);
  });

  it("recovers cached acceptance without another API call, even if only local pipeline state was lost", async () => {
    const w = await world(); const event = await w.event(); await w.tick(); w.advance(3000); await w.tick();
    await w.db.update(commentEvents).set({ status: "pending", replyStatus: null, replyCommentId: null, dmStatus: null, dmMessageId: null, runAt: w.now(), completedAt: null }).where(eq(commentEvents.id, event.id));
    expect(await w.tick()).toBe("succeeded"); expect(w.graph.replies).toHaveLength(1); expect(w.graph.dms).toHaveLength(1);
    expect((await w.db.select().from(usageCounters))[0].dmCount).toBe(1);
  });

  it("rejects a late worker result after a replacement claim and retains accepted late evidence without sending twice", async () => {
    const w = await world(true, false); await w.event(); await w.tick(); w.advance(3000);
    let release!: () => void; let started!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; }); const wait = new Promise<void>((resolve) => { release = resolve; });
    const original = w.graph.sendPrivateReply.bind(w.graph);
    w.graph.sendPrivateReply = async (...args) => { const result = await original(...args); started(); await wait; return result; };
    const old = w.tick(); await began; w.advance(LEGACY_EVENT_LEASE_MS + 1);
    expect(await w.tick()).toBe("send_unknown"); release(); expect(await old).toBe("stale");
    const [attempt] = await w.db.select().from(sendAttempts); expect(attempt.state).toBe("unknown"); expect(attempt.lateResult).toMatchObject({ state: "accepted" });
    expect(w.graph.dms).toHaveLength(1); expect((await w.db.select().from(usageCounters))[0].dmCount).toBe(1);
  });

  it("retries only an explicit format rejection later through the budget; 5xx never triggers format fallback", async () => {
    const w = await world(true, false); await w.event();
    w.graph.dmError = (message) => message.kind === "button" ? new GraphApiError("format", 400, 100, 2534015) : null;
    await w.tick(); w.advance(3000); expect(await w.tick()).toBe("deferred"); expect(w.graph.dms).toHaveLength(0);
    expect((await w.db.select().from(igAccounts))[0].dmFormat).toBe("text"); w.advance(9000);
    expect(await w.tick()).toBe("succeeded"); expect(w.graph.dms[0].message.kind).toBe("text");
    await w.db.update(igAccounts).set({ dmFormat: "button" }).where(eq(igAccounts.id, w.account.id)); await w.event();
    w.graph.dmError = () => new GraphApiError("server error with format subcode", 503, 100, 2534015);
    await w.tick(); w.advance(9000); expect(await w.tick()).toBe("send_unknown");
    expect((await w.db.select().from(igAccounts))[0].dmFormat).toBe("button"); expect(w.graph.dms).toHaveLength(1);
  });

  it("retains recent budgets after flag-OFF, then rearms warmup for untracked legacy usage on reactivation", async () => {
    const w = await world(true, false); await w.event(); await w.tick(); w.advance(3000); await w.tick();
    await w.db.update(featureFlags).set({ enabled: false });
    expect(await legacySendGuard(w.db, w.account.id, w.now())).toEqual({ guarded: true, enabled: false });
    w.advance(3_602_001);
    expect(await legacySendGuard(w.db, w.account.id, w.now())).toEqual({ guarded: false, enabled: false });
    await w.event(); expect(await w.tick()).toBe("succeeded");
    expect(await w.db.select().from(sendAttempts)).toHaveLength(1);
    await w.db.update(featureFlags).set({ enabled: true });
    expect((await legacySendGuard(w.db, w.account.id, w.now())).guarded).toBe(true);
    const [control] = await w.db.select().from(accountSendControls); expect(control.warmupUntil!.getTime()).toBe(w.now().getTime() + 3_602_000);
    await w.event(); await w.tick(); w.advance(3000); expect(await w.tick()).toBe("deferred"); expect(w.graph.dms).toHaveLength(2);
  });

  it("uses a verified comment creation timestamp and never sends an expired private reply", async () => {
    const w = await world(true, false); const event = await w.event();
    w.graph.comments[event.commentId].createdAt = new Date(CAMPAIGN_NOW.getTime() - 8 * 86_400_000);
    expect(await w.tick()).toBe("failed"); expect(w.graph.dms).toHaveLength(0); expect(await w.db.select().from(sendAttempts)).toHaveLength(0);
    expect((await w.db.select().from(usageCounters))[0].dmCount).toBe(0);
  });

  it("honors metadata Retry-After without treating a read failure as an ambiguous send", async () => {
    const w = await world(true, false); await w.event(); w.graph.commentError = new GraphApiError("read throttle", 429, 613, undefined, 120_000);
    expect(await w.tick()).toBe("deferred"); expect(await w.db.select().from(sendAttempts)).toHaveLength(0);
    const [event] = await w.db.select().from(commentEvents); expect(event.attempts).toBe(1); expect(event.runAt.getTime()).toBe(w.now().getTime() + 120_000);
    w.advance(120_000); w.graph.commentError = null; await w.tick(); w.advance(3000); expect(await w.tick()).toBe("succeeded");
    expect(w.graph.dms).toHaveLength(1);
  });

  it("uses a text response prompt for guarded follower requests and never sends the purchase URL first", async () => {
    const w = await world(true, false); await w.db.update(automations).set({ followGate: true }).where(eq(automations.id, w.automation.id));
    await w.event(); await w.tick(); w.advance(3000); expect(await w.tick()).toBe("awaiting_follow");
    expect(w.graph.dms[0].message.kind).toBe("text"); expect(w.graph.dms[0].message.text).toContain("팔로우했어요"); expect(w.graph.dms[0].message.text).not.toContain("shop.example");
  });
});
