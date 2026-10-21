import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { accountSendControls, conversationStates, featureFlags, followGates, igAccounts, messageEvents } from "@/server/db/schema";
import { parseCampaignMessages } from "@/server/instagram/campaign-messaging";
import { claimMessageEvents, expireMessageEvents, finishMessageEvent, ingestGuardedMessages, recoverMessageEvents } from "@/server/campaigns/message-inbox";
import { legacySendGuard } from "@/server/campaigns/legacy-guard";
import { CAMPAIGN_NOW, seedCampaignConfig } from "../helpers/campaigns";
import { createEvent, createIgAccount, createUser } from "../helpers/factories";
import { resetDb } from "../helpers/db";

const now = CAMPAIGN_NOW;
async function world(enabled = true) {
  await seedCampaignConfig(enabled);
  const account = await createIgAccount((await createUser()).id);
  const item = (mid: string, options: { timestamp?: number | null; text?: string; kind?: "message" | "postback" | "echo" | "deleted"; peer?: string } = {}) => {
    const kind = options.kind ?? "message"; const peer = options.peer ?? "person";
    return parseCampaignMessages(JSON.stringify({ object: "instagram", entry: [{ id: account.igUserId, time: now.getTime(), messaging: [{
      sender: { id: kind === "echo" ? account.igUserId : peer }, recipient: { id: kind === "echo" ? peer : account.igUserId },
      timestamp: options.timestamp === null ? undefined : options.timestamp ?? now.getTime(),
      ...(kind === "postback" ? { postback: { mid, payload: "cg1:12345678-1234-1234-1234-123456789abc" } } : { message: { mid, text: options.text ?? "팔로우했어요", is_echo: kind === "echo", is_deleted: kind === "deleted" } }),
    }] }] }))[0];
  };
  return { db: getDb(), account, item };
}

describe("durable messaging inbox", () => {
  beforeEach(resetDb);

  it("leaves never-enabled accounts on their original messaging path", async () => {
    const w = await world(false);
    const result = await ingestGuardedMessages(w.db, [w.item("m1")], now);
    expect(result.queued).toBe(0); expect(result.guardedIgUserIds.size).toBe(0);
    expect(await w.db.select().from(messageEvents)).toEqual([]); expect(await w.db.select().from(conversationStates)).toEqual([]);
  });

  it("persists one event for three concurrent deliveries and opens a window only at the original time", async () => {
    const w = await world(); const sent = now.getTime() - 300_000;
    const results = await Promise.all(Array.from({ length: 3 }, () => ingestGuardedMessages(w.db, [w.item("m1", { timestamp: sent })], now)));
    expect(results.reduce((sum, r) => sum + r.queued, 0)).toBe(1);
    expect(await w.db.select().from(messageEvents)).toHaveLength(1);
    const [conversation] = await w.db.select().from(conversationStates);
    expect(conversation.consentAt).toEqual(new Date(sent)); expect(conversation.lastUserInteractionAt).toEqual(new Date(sent));
    await ingestGuardedMessages(w.db, [w.item("older", { timestamp: sent - 60_000 })], now);
    expect((await w.db.select().from(conversationStates))[0].lastUserInteractionAt).toEqual(new Date(sent));
  });

  it("postbacks, echoes, deletions, future and absent timestamps cannot open or extend a conversation", async () => {
    const w = await world();
    await ingestGuardedMessages(w.db, [w.item("tap", { kind: "postback" }), w.item("out", { kind: "echo" }), w.item("gone", { kind: "deleted" }), w.item("future", { timestamp: now.getTime() + 1 }), w.item("missing", { timestamp: null })], now);
    expect((await w.db.select().from(conversationStates))[0]).toMatchObject({ consentAt: null, lastUserInteractionAt: null });
    const rows = await w.db.select().from(messageEvents); expect(rows.filter((r) => r.userMessageEvidence)).toEqual([]);
    expect(rows.filter((r) => r.lastErrorCode === "invalid_message_time")).toHaveLength(2);
  });

  it("retains deletion tombstones, scrubs content and suppresses an out-of-order original", async () => {
    const w = await world();
    await ingestGuardedMessages(w.db, [w.item("late", { kind: "deleted" }), w.item("late")], now);
    const [original] = await w.db.select().from(messageEvents).where(eq(messageEvents.kind, "message"));
    expect(original).toMatchObject({ text: "", payload: null, status: "ignored", lastErrorCode: "message_deleted" });
    expect(original.deletedAt).toEqual(now); expect((await w.db.select().from(conversationStates))[0].consentAt).toBeNull();
    await ingestGuardedMessages(w.db, [w.item("before"), w.item("before", { kind: "deleted" })], now);
    expect((await w.db.select().from(messageEvents).where(and(eq(messageEvents.providerMessageId, "before"), eq(messageEvents.kind, "message"))))[0]).toMatchObject({ text: "", deletedAt: now });
  });

  it("claims once across workers, survives a restart and rejects a late reader's route result", async () => {
    const w = await world(); await ingestGuardedMessages(w.db, [w.item("m1")], now);
    const claimed = (await Promise.all([claimMessageEvents(w.db, { batch: 10, now }), claimMessageEvents(w.db, { batch: 10, now })])).flat();
    expect(claimed).toHaveLength(1);
    const later = new Date(now.getTime() + 61_000);
    expect(await recoverMessageEvents(w.db, later)).toBe(1);
    const [resumed] = await claimMessageEvents(w.db, { batch: 10, now: later });
    await finishMessageEvent(w.db, claimed[0], later, "routed", null);
    expect((await w.db.select().from(messageEvents))[0].status).toBe("leased");
    await finishMessageEvent(w.db, resumed, later, "routed", null);
    expect(await claimMessageEvents(w.db, { batch: 10, now: later })).toEqual([]);
  });

  it("removes inbox and consent state when the connected account is deleted", async () => {
    const w = await world(); await ingestGuardedMessages(w.db, [w.item("m1")], now);
    await w.db.delete(igAccounts).where(eq(igAccounts.id, w.account.id));
    expect(await w.db.select().from(messageEvents)).toEqual([]); expect(await w.db.select().from(conversationStates)).toEqual([]);
  });

  it("keeps a delayed response to a guarded legacy request durable after the OFF safety hour has elapsed", async () => {
    const w = await world(); await legacySendGuard(w.db, w.account.id, now);
    const event = await createEvent(w.account, { commenterIgId: "person", status: "awaiting_follow", guardedJitterUntil: now, dmMessageId: "initial-accepted" });
    await w.db.insert(followGates).values({ igAccountId: w.account.id, eventId: event.id });
    await w.db.update(featureFlags).set({ enabled: false });
    await w.db.update(accountSendControls).set({ safetyUntil: now, lastObservedEnabled: false });
    const later = new Date(now.getTime() + 2 * 3_600_000);
    expect((await ingestGuardedMessages(w.db, [w.item("late", { timestamp: later.getTime() })], later)).queued).toBe(1);
  });

  it("expires pending responses even while the feature is disabled", async () => {
    const w = await world(); await ingestGuardedMessages(w.db, [w.item("old")], now);
    await w.db.update(featureFlags).set({ enabled: false });
    expect(await expireMessageEvents(w.db, new Date(now.getTime() + 86_400_000))).toBe(1);
    expect((await w.db.select().from(messageEvents))[0]).toMatchObject({ status: "ignored", lastErrorCode: "message_window_closed" });
  });
});
