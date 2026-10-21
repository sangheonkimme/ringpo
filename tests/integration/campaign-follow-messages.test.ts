import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { campaignDeliveries, conversationStates, dmJobs, featureFlags, messageEvents } from "@/server/db/schema";
import { decryptSecret } from "@/server/crypto";
import { GraphApiError, GraphNetworkError } from "@/server/instagram/errors";
import { parseCampaignMessages } from "@/server/instagram/campaign-messaging";
import { dispatchCampaignJob, type DispatchDeps } from "@/server/campaigns/dispatch";
import { claimCampaignJobs, expireCampaignJobs } from "@/server/campaigns/jobs";
import { routeCampaignFollowMessage } from "@/server/campaigns/follow-messages";
import { claimMessageEvents, ingestGuardedMessages, recoverMessageEvents } from "@/server/campaigns/message-inbox";
import { renderCampaignMessage } from "@/server/campaigns/render";
import { claimCampaignEvents, routeCampaignEvent } from "@/server/campaigns/routing";
import { publishCampaign, saveCampaign } from "@/server/campaigns/service";
import { ingestComments } from "@/server/queue/ingest";
import { campaignWorld, CAMPAIGN_NOW, seedCampaignConfig } from "../helpers/campaigns";
import { createIgAccount, createUser, setPlan } from "../helpers/factories";
import { resetDb } from "../helpers/db";

async function world(failurePolicy: "send_link" | "hold" = "send_link", knownFollower = false) {
  const db = getDb(); const user = await createUser(); const account = await createIgAccount(user.id); await setPlan(user.id, "pro");
  const { graph, input } = campaignWorld(account);
  const campaign = await saveCampaign(db, user.id, { ...input, followOnly: true, followFailurePolicy: failurePolicy }, { graph, decrypt: decryptSecret, now: CAMPAIGN_NOW, appUrl: "https://ringpo.test" });
  let now = new Date(input.openAt); await publishCampaign(db, user.id, campaign.id, true, now);
  graph.comments.comment = { id: "comment", authorId: "person", mediaId: input.mediaIds[0], createdAt: now };
  await ingestComments(db, [{ igUserId: account.igUserId, commentId: "comment", commenterIgId: "person", commenterUsername: "fixture", mediaId: input.mediaIds[0], mediaProductType: "FEED", parentCommentId: null, text: "링크" }], now);
  const routerDeps = { db, graph, now: () => now, decryptToken: decryptSecret };
  for (const event of await claimCampaignEvents(db, { batch: 10, now })) await routeCampaignEvent({ ...routerDeps, hashKey: "fixture" }, event);
  const deps: DispatchDeps = { db, graph, decryptToken: decryptSecret, random: () => 0, clock: async () => now, render: (tx, context) => renderCampaignMessage(tx, context, "https://ringpo.test") };
  const tick = async () => Promise.all((await claimCampaignJobs(db, { batch: 10, now, workerId: "test" })).map((job) => dispatchCampaignJob(deps, job)));
  if (knownFollower) {
    graph.followers.add("person");
    await db.insert(conversationStates).values({ igAccountId: account.id, senderId: "person", consentAt: new Date(now.getTime() - 86_400_000), lastUserInteractionAt: new Date(now.getTime() - 86_400_000) });
  }
  await tick(); now = new Date(now.getTime() + 3000); await tick(); now = new Date(now.getTime() + 1000);
  const [gate] = await db.select().from(dmJobs).where(eq(dmJobs.kind, "follow_request"));
  const receive = async (mid = "response", options: { peer?: string; postback?: boolean; timestamp?: Date; text?: string; payload?: string; replyTo?: string; deleted?: boolean } = {}) => {
    const parsed = parseCampaignMessages(JSON.stringify({ object: "instagram", entry: [{ id: account.igUserId, messaging: [{ sender: { id: options.peer ?? "person" }, recipient: { id: account.igUserId }, timestamp: (options.timestamp ?? now).getTime(),
      ...(options.postback ? { postback: { mid, payload: options.payload ?? `cg1:${gate.id}` } } : { message: { mid, text: options.text ?? "팔로우했어요!", is_deleted: options.deleted, ...(options.replyTo ? { reply_to: { mid: options.replyTo } } : {}), ...(options.payload ? { quick_reply: { payload: options.payload } } : {}) } }),
    }] }] }));
    return ingestGuardedMessages(db, parsed, now);
  };
  const route = async () => Promise.all((await claimMessageEvents(db, { batch: 10, now })).map((m) => routeCampaignFollowMessage(routerDeps, m)));
  return { db, user, account, campaign, graph, gate, deps, routerDeps, receive, route, tick, now: () => now, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
}

describe("campaign follow response -> durable ordinary DM", () => {
  beforeEach(async () => { await resetDb(); await seedCampaignConfig(); });

  it("can give a known consenting follower the first private link even when no ordinary message window is open", async () => {
    const w = await world("send_link", true);
    expect(w.graph.followReads).toBe(1); expect(w.graph.messages).toHaveLength(0);
    expect(w.graph.dms[0].message).toMatchObject({ kind: "button", url: expect.stringContaining("/r/") });
    expect(await w.db.select().from(dmJobs).where(eq(dmJobs.kind, "follow_request"))).toEqual([]);
  });

  it("serializes concurrent confirmations into one link job", async () => {
    const w = await world(); w.graph.followers.add("person");
    await Promise.all([w.receive("one"), w.receive("two")]);
    const outcomes = await w.route(); expect(outcomes.filter((v) => v === "follow_link")).toHaveLength(1);
    expect(await w.db.select().from(dmJobs).where(eq(dmJobs.kind, "follow_link"))).toHaveLength(1);
  });

  it("requests an actual response first, then sends one link for repeated responses from the expected person", async () => {
    const w = await world(); expect(w.graph.followReads).toBe(0); expect(w.graph.dms).toHaveLength(1);
    expect(w.graph.dms[0].message).toMatchObject({ kind: "text", text: expect.stringContaining("답장") });
    w.graph.followers.add("person"); await w.receive(); await w.receive(); expect(await w.route()).toEqual(["follow_link"]);
    await w.receive("again", { payload: `cg1:${w.gate.id}` }); expect(await w.route()).toEqual(["link_already_reserved"]);
    await w.tick(); w.advance(3000); expect(await w.tick()).toContain("sent");
    expect(w.graph.messages).toHaveLength(1); expect(w.graph.messages[0]).toMatchObject({ recipientId: "person", message: { kind: "button", url: expect.stringContaining("https://ringpo.test/r/") } });
    expect((await w.db.select().from(campaignDeliveries).where(eq(campaignDeliveries.intent, "link")))[0].state).toBe("sent");
  });

  it("a postback alone grants no window; forged recipient, unrelated text and negative response cannot route a gate", async () => {
    const w = await world(); w.graph.followers.add("person");
    await w.receive("tap", { postback: true }); expect(await w.route()).toEqual(["message_window_closed"]); expect(w.graph.followReads).toBe(0);
    await w.receive("forged", { peer: "attacker", payload: `cg1:${w.gate.id}` }); expect(await w.route()).toEqual([null]);
    await w.receive("negative", { text: "팔로우 안 했어요", replyTo: w.gate.providerMessageId! }); expect(await w.route()).toEqual([null]);
    expect(w.graph.followReads).toBe(0); expect(w.graph.messages).toHaveLength(0);
  });

  it("sends at most one non-follower reminder, then one link after a later verified response", async () => {
    const w = await world(); await w.receive(); expect(await w.route()).toEqual(["follow_reminder"]);
    await w.receive("repeat"); expect(await w.route()).toEqual(["duplicate"]);
    await w.tick(); w.advance(3000); await w.tick(); expect(w.graph.messages).toHaveLength(1);
    w.advance(1000); w.graph.followers.add("person"); await w.receive("followed"); expect(await w.route()).toEqual(["follow_link"]);
    w.advance(9000); await w.tick(); w.advance(3000); await w.tick(); expect(w.graph.messages).toHaveLength(2);
  });

  it("does not retroactively authorize a postback using a later unrelated user message", async () => {
    const w = await world(); w.graph.followers.add("person");
    await w.receive("old-tap", { postback: true }); w.advance(1000);
    await w.receive("later-greeting", { text: "안녕하세요" });
    const outcomes = await w.route(); expect(outcomes).toContain("postback_without_prior_consent"); expect(outcomes).toContain(null);
    expect(w.graph.followReads).toBe(0); expect(w.graph.messages).toHaveLength(0);
  });

  it.each([new GraphNetworkError("secret"), new GraphApiError("secret", 503, 2)])("fails open only for an outage after consent", async (error) => {
    const w = await world(); w.graph.followError = error;
    await w.receive(); expect(await w.route()).toEqual(["follow_link"]);
    const [message] = await w.db.select().from(messageEvents); expect(message.lastErrorCode).toMatch(/^profile_fail_open:/); expect(message.lastErrorCode).not.toContain("secret");
  });

  it.each([new GraphApiError("denied", 403, 200), new GraphApiError("token", 400, 190)])("does not fail open for access/token errors", async (error) => {
    const w = await world(); w.graph.followError = error;
    await w.receive(); expect(await w.route()).toEqual(["profile_failed"]);
    expect(await w.db.select().from(dmJobs).where(eq(dmJobs.channel, "message"))).toEqual([]);
  });

  it("keeps a missing field unknown and respects hold policy and API Retry-After", async () => {
    const w = await world("hold"); w.graph.missingFollowField = true;
    await w.receive(); expect(await w.route()).toEqual(["profile_failed"]);
    w.graph.missingFollowField = false; w.graph.followError = new GraphNetworkError("timeout");
    await w.receive("second"); expect(await w.route()).toEqual(["profile_retry"]);
    w.advance(30_000); w.graph.followError = new GraphApiError("rate", 429, 613, undefined, 120_000);
    expect(await w.route()).toEqual(["profile_retry"]);
    expect((await w.db.select().from(messageEvents).where(eq(messageEvents.providerMessageId, "second")))[0].nextAttemptAt).toEqual(new Date(w.now().getTime() + 120_000));
  });

  it("does not revive an old response after a new conversation opens, and cancels deleted source messages", async () => {
    const w = await world(); w.graph.followers.add("person"); await w.receive(); await w.route();
    await w.receive("response", { deleted: true });
    expect(await w.tick()).toContain("expired"); expect(w.graph.messages).toHaveLength(0);
    w.advance(24 * 3_600_000); await w.receive("new-window", { text: "안녕하세요" });
    const [conversation] = await w.db.select().from(conversationStates); expect(conversation.lastUserInteractionAt).toEqual(w.now());
    expect(w.graph.messages).toHaveLength(0);
  });

  it("a stale profile reader cannot create a job after its lease was recovered", async () => {
    const w = await world(); await w.receive();
    const [claimed] = await claimMessageEvents(w.db, { batch: 1, now: w.now() });
    w.graph.getFollowerProfile = async () => {
      w.advance(61_000); await recoverMessageEvents(w.db, w.now());
      await claimMessageEvents(w.db, { batch: 1, now: w.now() });
      return { following: true };
    };
    expect(await routeCampaignFollowMessage(w.routerDeps, claimed)).toBe("stale_lease");
    expect(await w.db.select().from(dmJobs).where(eq(dmJobs.channel, "message"))).toEqual([]);
  });

  it("a fresh explicit response can replace a never-attempted expired link, retaining the old expired job", async () => {
    const w = await world(); w.graph.followers.add("person"); await w.receive(); await w.route();
    w.advance(86_400_000); await expireCampaignJobs(w.db, w.now());
    await w.receive("new-confirmation"); expect(await w.route()).toEqual(["follow_link"]);
    const links = await w.db.select().from(dmJobs).where(eq(dmJobs.kind, "follow_link"));
    expect(links.map((j) => j.status).sort()).toEqual(["expired", "waiting"]);
    expect(new Set(links.map((j) => j.sourceMessageEventId)).size).toBe(2);
    await w.tick(); w.advance(3000); await w.tick(); expect(w.graph.messages).toHaveLength(1);
  });

  it("a fresh response cannot replace an unknown link attempt", async () => {
    const w = await world(); w.graph.followers.add("person"); await w.receive(); await w.route();
    await w.db.update(dmJobs).set({ status: "unknown", attempts: 1 }).where(eq(dmJobs.kind, "follow_link"));
    await w.receive("new-confirmation", { payload: `cg1:${w.gate.id}` }); expect(await w.route()).toEqual(["link_already_reserved"]);
    expect(await w.db.select().from(dmJobs).where(eq(dmJobs.kind, "follow_link"))).toHaveLength(1);
    expect(w.graph.messages).toHaveLength(0);
  });

  it("flag OFF keeps already-routed jobs from sending", async () => {
    const w = await world(); w.graph.followers.add("person"); await w.receive(); await w.route();
    await w.db.update(featureFlags).set({ enabled: false });
    expect(await w.tick()).toEqual([]); expect(w.graph.messages).toHaveLength(0);
    expect((await w.db.select().from(dmJobs).where(and(eq(dmJobs.channel, "message"), eq(dmJobs.kind, "follow_link"))))[0].status).toBe("waiting");
  });
});
