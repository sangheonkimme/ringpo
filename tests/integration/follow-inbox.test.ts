import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { claimMessageEvents, ingestGuardedMessages, recoverMessageEvents } from "@/server/campaigns/message-inbox";
import { legacyInboxOverview } from "@/server/campaigns/inbox-overview";
import { decryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { accountSendControls, automations, commentEvents, followGates, messageEvents, sendAttempts, sendBuckets } from "@/server/db/schema";
import { parseCampaignMessages } from "@/server/instagram/campaign-messaging";
import { GraphApiError, GraphNetworkError } from "@/server/instagram/errors";
import { routeLegacyFollowMessage } from "@/server/pipeline/follow-inbox";
import { claimEvents } from "@/server/queue/events";
import { CAMPAIGN_NOW, seedCampaignConfig } from "../helpers/campaigns";
import { resetDb } from "../helpers/db";
import { createAutomation, createEvent, createIgAccount, createUser } from "../helpers/factories";
import { FakeGraphClient } from "../helpers/fake-graph";

async function world() {
  await seedCampaignConfig(); const db = getDb(); const owner = await createUser(); const account = await createIgAccount(owner.id);
  const automation = await createAutomation(account, { followGate: true });
  const event = await createEvent(account, { automationId: automation.id, commenterIgId: "900", status: "awaiting_follow", replyStatus: "sent", dmMessageId: "private-id", guardedJitterUntil: CAMPAIGN_NOW, completedAt: new Date(CAMPAIGN_NOW.getTime() - 1000) });
  const [gate] = await db.insert(followGates).values({ igAccountId: account.id, eventId: event.id }).returning();
  let now = CAMPAIGN_NOW; const graph = new FakeGraphClient(); graph.followers.add("900");
  const deps = { db, graph, now: () => now, clock: async () => now, decryptToken: decryptSecret, random: () => 0, appUrl: "https://app.test" };
  async function receive(options: { peer?: string; kind?: "message" | "postback"; at?: Date; mid?: string; explicit?: boolean } = {}) {
    const mid = options.mid ?? randomUUID(); const payload = `fg:${gate.id}`;
    const detail = options.kind === "postback" ? { postback: { mid, payload } } : { message: { mid, text: "팔로우했어요", ...(options.explicit === false ? {} : { quick_reply: { payload } }) } };
    const parsed = parseCampaignMessages(JSON.stringify({ object: "instagram", entry: [{ id: account.igUserId, messaging: [{ sender: { id: options.peer ?? "900" }, recipient: { id: account.igUserId }, timestamp: (options.at ?? now).getTime(), ...detail }] }] }));
    await ingestGuardedMessages(db, parsed, now);
    return (await claimMessageEvents(db, { batch: 20, now }))[0];
  }
  async function resume() { const [source] = await claimMessageEvents(db, { batch: 20, now }); expect(source).toBeDefined(); return routeLegacyFollowMessage(deps, source); }
  async function send() { const source = await receive(); expect(await routeLegacyFollowMessage(deps, source)).toBe("waiting"); now = new Date(now.getTime() + 3000); return resume(); }
  return { db, account, event, gate, graph, deps, receive, resume, send, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
}

describe("guarded legacy follow-up inbox", () => {
  beforeEach(resetDb);

  it("sends one link across repeated deliveries and distinct confirmations, without charging usage again", async () => {
    const w = await world(); expect(await w.send()).toBe("sent");
    const duplicate = await w.receive({ mid: "second" }); expect(await routeLegacyFollowMessage(w.deps, duplicate)).toBe("duplicate");
    expect(w.graph.messages).toHaveLength(1);
    expect((await w.db.select().from(sendAttempts))[0]).toMatchObject({ state: "accepted", channel: "message", legacyEventId: w.event.id });
    expect((await w.db.select().from(followGates))[0]).toMatchObject({ status: "sent", checks: 0 });
    expect((await w.db.select().from(commentEvents))[0]).toMatchObject({ status: "succeeded", dmStatus: "sent", dmMessageId: "mid-1" });
  });

  it("requires the expected sender and a verified messaging window; a postback alone authorizes no lookup", async () => {
    const w = await world();
    const forged = await w.receive({ peer: "attacker" }); expect(await routeLegacyFollowMessage(w.deps, forged)).toBe("ignored");
    const tap = await w.receive({ kind: "postback" }); expect(await routeLegacyFollowMessage(w.deps, tap)).toBe("message_window_closed");
    expect(w.graph.followReads).toBe(0); expect(w.graph.messages).toHaveLength(0);
  });

  it("retains pre-ledger uncertainty and never resends an old ambiguous waiting gate", async () => {
    const w = await world(); await w.db.update(followGates).set({ checks: 1 }).where(eq(followGates.id, w.gate.id));
    const source = await w.receive(); expect(await routeLegacyFollowMessage(w.deps, source)).toBe("send_unknown");
    expect(w.graph.followReads).toBe(0); expect(w.graph.messages).toHaveLength(0);
    expect((await w.db.select().from(messageEvents))[0]).toMatchObject({ status: "send_unknown", lastErrorCode: "legacy_follow_history_unverified" });
  });

  it("sends at most one reminder and later one link after a new verified response", async () => {
    const w = await world(); w.graph.followers.clear(); expect(await w.send()).toBe("sent");
    const second = await w.receive(); expect(await routeLegacyFollowMessage(w.deps, second)).toBe("duplicate");
    w.advance(10_000); w.graph.followers.add("900"); expect(await w.send()).toBe("sent");
    expect(w.graph.messages).toHaveLength(2); expect(w.graph.messages[0].message.kind).toBe("text"); expect(w.graph.messages[1].message.kind).toBe("button");
  });

  it("holds profile outages instead of failing open, with the source bound for seller diagnostics", async () => {
    const w = await world(); w.graph.followError = new GraphNetworkError("timeout");
    const source = await w.receive(); expect(await routeLegacyFollowMessage(w.deps, source)).toBe("profile_retry");
    expect((await w.db.select().from(messageEvents))[0]).toMatchObject({ status: "pending", legacyEventId: w.event.id, lastErrorCode: "network" });
    expect(await legacyInboxOverview(w.db, w.account.userId, w.event.automationId!)).toEqual({ total: 1, pending: 1, failed: 0, unknown: 0, expired: 0 });
    expect(await legacyInboxOverview(w.db, "another-user", w.event.automationId!)).toBeNull();
    expect(w.graph.messages).toHaveLength(0);
  });

  it("keeps the original response deadline even after a newer unrelated incoming message", async () => {
    const w = await world(); const source = await w.receive(); expect(await routeLegacyFollowMessage(w.deps, source)).toBe("waiting");
    w.advance(24 * 3_600_000); const fresh = await w.receive({ mid: "fresh" });
    // claim returns the older due source first; the newer consent cannot revive it.
    expect(fresh.id).toBe(source.id); expect(await routeLegacyFollowMessage(w.deps, fresh)).toBe("message_window_closed");
    expect(w.graph.messages).toHaveLength(0);
  });

  it("rechecks source deletion after a profile read", async () => {
    const w = await world(); const source = await w.receive();
    w.graph.getFollowerProfile = async () => { await w.db.update(messageEvents).set({ deletedAt: w.deps.now() }).where(eq(messageEvents.id, source.id)); return { following: true }; };
    expect(await routeLegacyFollowMessage(w.deps, source)).toBe("source_message_unavailable"); expect(w.graph.messages).toHaveLength(0);
  });

  it("shares the ordinary-message account budget and respects a manual pause", async () => {
    const w = await world(); const source = await w.receive(); expect(await routeLegacyFollowMessage(w.deps, source)).toBe("waiting"); w.advance(3000);
    await w.db.update(accountSendControls).set({ manualPaused: true }).where(eq(accountSendControls.igAccountId, w.account.id));
    expect(await w.resume()).toBe("deferred"); expect(w.graph.messages).toHaveLength(0);
    await w.db.update(accountSendControls).set({ manualPaused: false }).where(eq(accountSendControls.igAccountId, w.account.id)); w.advance(60_000);
    await w.db.update(sendBuckets).set({ tokens: 0, refilledAt: w.deps.now(), nextEligibleAt: new Date(w.deps.now().getTime() + 9000) }).where(and(eq(sendBuckets.igAccountId, w.account.id), eq(sendBuckets.channel, "message")));
    expect(await w.resume()).toBe("deferred"); w.advance(9000); expect(await w.resume()).toBe("sent");
  });

  it.each([new GraphNetworkError("lost response"), new GraphApiError("upstream", 500, 100, 2534015)])("never falls back or resends after an ambiguous write: %s", async (error) => {
    const w = await world(); let calls = 0; w.graph.sendMessage = async () => { calls++; throw error; };
    expect(await w.send()).toBe("send_unknown"); w.advance(10_000);
    const source = await w.receive(); expect(await routeLegacyFollowMessage(w.deps, source)).toBe("send_unknown");
    expect(calls).toBe(1); expect((await w.db.select().from(sendAttempts))[0].state).toBe("unknown");
  });

  it("retries only a known format rejection at a new budget slot and renders the latest template", async () => {
    const w = await world(); const send = w.graph.sendMessage.bind(w.graph); let first = true;
    w.graph.sendMessage = async (...args) => { if (first) { first = false; throw new GraphApiError("format", 400, 100, 2534015); } return send(...args); };
    expect(await w.send()).toBe("retry");
    await w.db.update(automations).set({ dmText: "새로 저장한 상품 안내" }).where(eq(automations.id, w.event.automationId!));
    w.advance(60_000); expect(await w.resume()).toBe("sent");
    expect(w.graph.messages).toHaveLength(1); expect(w.graph.messages[0].message.kind).toBe("text");
    expect(w.graph.messages[0].message.text).toContain("새로 저장한 상품 안내");
    expect((await w.db.select().from(sendAttempts)).map((a) => a.state).sort()).toEqual(["accepted", "rejected"]);
  });

  it("does not let another confirmation or the old public-reply worker claim an in-flight link", async () => {
    const w = await world(); const source = await w.receive(); await routeLegacyFollowMessage(w.deps, source); w.advance(3000);
    await w.db.update(commentEvents).set({ status: "pending", runAt: w.deps.now(), replyStatus: null }).where(eq(commentEvents.id, w.event.id));
    let release!: () => void; let entered!: () => void; const enteredPromise = new Promise<void>((r) => { entered = r; }); const gate = new Promise<void>((r) => { release = r; });
    const send = w.graph.sendMessage.bind(w.graph); w.graph.sendMessage = async (...args) => { entered(); await gate; return send(...args); };
    const sending = w.resume(); await enteredPromise;
    expect(await claimEvents(w.db, { batch: 10, now: w.deps.now() })).toEqual([]);
    const other = await w.receive(); expect(await routeLegacyFollowMessage(w.deps, other)).toBe("in_flight");
    release(); expect(await sending).toBe("sent");
    expect((await w.db.select().from(commentEvents))[0]).toMatchObject({ status: "pending", dmStatus: "sent", dmMessageId: "mid-1" });
    expect(await claimEvents(w.db, { batch: 10, now: w.deps.now() })).toHaveLength(1);
  });

  it("recovers a crashed write as unknown and records a late acceptance without reviving the source", async () => {
    const w = await world(); const source = await w.receive(); await routeLegacyFollowMessage(w.deps, source); w.advance(3000);
    let release!: () => void; let entered!: () => void; const enteredPromise = new Promise<void>((r) => { entered = r; }); const gate = new Promise<void>((r) => { release = r; });
    w.graph.sendMessage = async () => { entered(); await gate; return { messageId: "late-id" }; };
    const sending = w.resume(); await enteredPromise; w.advance(120_000);
    expect(await recoverMessageEvents(w.db, w.deps.now())).toBe(1); expect(await recoverMessageEvents(w.db, w.deps.now())).toBe(0);
    release(); expect(await sending).toBe("stale_lease");
    expect((await w.db.select().from(messageEvents))[0].status).toBe("send_unknown");
    expect((await w.db.select().from(sendAttempts))[0]).toMatchObject({ state: "unknown", lateResult: { state: "accepted", providerMessageId: "late-id" } });
    expect((await w.db.select().from(sendBuckets)).find((b) => b.channel === "message")?.leaseOwner).toBeNull();
  });
});
