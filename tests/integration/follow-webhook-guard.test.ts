import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { legacySendGuard } from "@/server/campaigns/legacy-guard";
import { getDb } from "@/server/db/client";
import { accountSendControls, featureFlags, followGates, messageEvents } from "@/server/db/schema";
import { decryptSecret } from "@/server/crypto";
import { parseCampaignMessages } from "@/server/instagram/campaign-messaging";
import { handleLegacyTapWithGuard } from "@/server/pipeline/follow-webhook";
import { CAMPAIGN_NOW, seedCampaignConfig } from "../helpers/campaigns";
import { createAutomation, createEvent, createIgAccount, createUser } from "../helpers/factories";
import { FakeGraphClient } from "../helpers/fake-graph";
import { resetDb } from "../helpers/db";

async function world(enabled = false, guarded = false) {
  await seedCampaignConfig(enabled);
  const db = getDb(); const owner = await createUser(); const account = await createIgAccount(owner.id); const automation = await createAutomation(account, { followGate: true });
  const event = await createEvent(account, { automationId: automation.id, commenterIgId: "900", status: "awaiting_follow", replyStatus: "sent", dmMessageId: "private-accepted", guardedJitterUntil: guarded ? CAMPAIGN_NOW : null });
  const [gate] = await db.insert(followGates).values({ igAccountId: account.id, eventId: event.id }).returning();
  let now = CAMPAIGN_NOW; const graph = new FakeGraphClient(); graph.followers.add("900");
  const tap = { igUserId: account.igUserId, senderId: "900", gateId: gate.id };
  const messages = parseCampaignMessages(JSON.stringify({ object: "instagram", entry: [{ id: account.igUserId, messaging: [{ sender: { id: "900" }, recipient: { id: account.igUserId }, timestamp: now.getTime(), message: { mid: "response", text: "팔로우했어요", quick_reply: { payload: `fg:${gate.id}` } } }] }] }));
  const deps = { db, graph, now: () => now, random: () => 0, sleep: async () => {}, decryptToken: decryptSecret, appUrl: "https://app.test", hourlyLimit: 700 };
  return { db, account, event, gate, graph, tap, messages, deps, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
}

describe("legacy webhook handoff at flag boundaries", () => {
  beforeEach(resetDb);

  it("keeps never-enabled OFF behavior and records otherwise-untracked ordinary message usage for future activation", async () => {
    const w = await world();
    expect(await handleLegacyTapWithGuard(w.deps, w.tap, w.messages)).toBe("sent");
    expect(w.graph.messages).toHaveLength(1); expect(await w.db.select().from(messageEvents)).toEqual([]);
    expect((await w.db.select().from(followGates))[0].lastUntrackedSendAt).toEqual(CAMPAIGN_NOW);
    await w.db.update(featureFlags).set({ enabled: true, defaultEnabled: true });
    await legacySendGuard(w.db, w.account.id, CAMPAIGN_NOW);
    expect((await w.db.select().from(accountSendControls))[0].warmupUntil).toEqual(new Date(CAMPAIGN_NOW.getTime() + 3_602_000));
  });

  it("never sends a legacy-shaped tap rejected by the strict parser when the account is enabled", async () => {
    const w = await world(true);
    expect(await handleLegacyTapWithGuard(w.deps, w.tap, [])).toBe("guarded");
    expect(w.graph.messages).toHaveLength(0); expect(await w.db.select().from(messageEvents)).toEqual([]);
  });

  it.each([true, false])("hands off a flag change during profile lookup without a link/reminder write: following=%s", async (following) => {
    const w = await world();
    w.graph.isFollower = async () => { await w.db.update(featureFlags).set({ enabled: true, defaultEnabled: true }); return following; };
    expect(await handleLegacyTapWithGuard(w.deps, w.tap, w.messages)).toBe("guarded");
    expect(w.graph.messages).toHaveLength(0);
    expect((await w.db.select().from(followGates))[0]).toMatchObject({ status: "waiting", checks: 0 });
    expect((await w.db.select().from(messageEvents))[0]).toMatchObject({ status: "pending", userMessageEvidence: true });
  });

  it("does not let a forged sender fall into the old handler for an unfinished guarded gate after OFF", async () => {
    const w = await world(true, true); await legacySendGuard(w.db, w.account.id, CAMPAIGN_NOW);
    await w.db.update(featureFlags).set({ enabled: false }); w.advance(2 * 3_600_000);
    expect(await handleLegacyTapWithGuard(w.deps, { ...w.tap, senderId: "attacker" }, [])).toBe("guarded");
    expect(w.graph.messages).toHaveLength(0);
  });

  it("warms up conservatively when historical untracked tap timing is unknown", async () => {
    const w = await world(); await w.db.update(followGates).set({ checks: 3 }).where(eq(followGates.id, w.gate.id));
    await w.db.update(featureFlags).set({ enabled: true, defaultEnabled: true });
    await legacySendGuard(w.db, w.account.id, CAMPAIGN_NOW);
    expect((await w.db.select().from(accountSendControls))[0].warmupUntil).toEqual(new Date(CAMPAIGN_NOW.getTime() + 3_602_000));
  });
});
