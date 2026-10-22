import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { campaignFaqs, campaignParticipants, conversationStates, dmJobs, featureFlagOverrides, featureFlags, igAccounts, messageEvents } from "@/server/db/schema";
import { decryptSecret } from "@/server/crypto";
import { saveCampaign, publishCampaign } from "@/server/campaigns/service";
import { campaignFaqOverview, saveCampaignFaq, setConversationPause } from "@/server/campaigns/faq-service";
import { FAQ_HANDOFF_FLAG } from "@/server/campaigns/faq-access";
import { parseCampaignMessages } from "@/server/instagram/campaign-messaging";
import { GraphNetworkError } from "@/server/instagram/errors";
import { claimMessageEvents, ingestGuardedMessages, recoverMessageEvents } from "@/server/campaigns/message-inbox";
import { routeMessageEvent } from "@/server/campaigns/message-router";
import { claimCampaignJobs } from "@/server/campaigns/jobs";
import { dispatchCampaignJob, prepareCampaignSend, invokePreparedSend, settleCampaignSend, type DispatchDeps } from "@/server/campaigns/dispatch";
import { renderCampaignMessage } from "@/server/campaigns/render";
import { CAMPAIGN_NOW, campaignWorld, seedCampaignConfig } from "../helpers/campaigns";
import { createIgAccount, createUser, setPlan } from "../helpers/factories";
import { resetDb } from "../helpers/db";

async function world(ready = true) {
  const db = getDb(), user = await createUser(), account = await createIgAccount(user.id); await setPlan(user.id, "pro");
  const { graph, input } = campaignWorld(account); let now = new Date(input.openAt);
  const campaign = await saveCampaign(db, user.id, input, { now: CAMPAIGN_NOW, graph, decrypt: decryptSecret, appUrl: "https://ringpo.test" });
  await publishCampaign(db, user.id, campaign.id, false, now);
  if (ready) { await db.update(featureFlags).set({ enabled: true }).where(eq(featureFlags.key, FAQ_HANDOFF_FLAG)); await db.insert(featureFlagOverrides).values({ flagKey: FAQ_HANDOFF_FLAG, igAccountId: account.id, enabled: true }); }
  const ruleInput = { campaignId: campaign.id, requestId: randomUUID(), keywords: ["배송"], excludedKeywords: ["취소"], matchType: "contains", answer: "내일 발송합니다.", enabled: true, priority: 0 };
  await saveCampaignFaq(db, user.id, ruleInput, now);
  const deps = { db, graph, now: () => now, decryptToken: decryptSecret, random: () => 0, appUrl: "https://ringpo.test" };
  const dispatch: DispatchDeps = { ...deps, clock: async () => now, render: (tx, c) => renderCampaignMessage(tx, c, deps.appUrl) };
  const receive = async (mid: string, options: { peer?: string; text?: string; time?: Date; echo?: boolean; deleted?: boolean; postback?: boolean; replyTo?: string } = {}) => {
    const peer = options.peer ?? "person";
    return ingestGuardedMessages(db, parseCampaignMessages(JSON.stringify({ object: "instagram", entry: [{ id: account.igUserId, messaging: [{ sender: { id: options.echo ? account.igUserId : peer }, recipient: { id: options.echo ? peer : account.igUserId }, timestamp: (options.time ?? now).getTime(),
      ...(options.postback ? { postback: { mid, payload: "shipping" } } : { message: { mid, text: options.text ?? "배송 언제예요?", is_echo: options.echo, is_deleted: options.deleted, ...(options.replyTo ? { reply_to: { mid: options.replyTo } } : {}) } }) }] }] })), now);
  };
  const route = async () => { const outcomes = []; for (const m of await claimMessageEvents(db, { batch: 20, now })) outcomes.push(await routeMessageEvent(deps, m)); return outcomes; };
  const tick = async () => { const outcomes = []; for (const j of await claimCampaignJobs(db, { batch: 20, now, workerId: "faq-test" })) outcomes.push(await dispatchCampaignJob(dispatch, j)); return outcomes; };
  const advance = (ms: number) => { now = new Date(now.getTime() + ms); };
  const send = async () => { await tick(); advance(10_000); await tick(); };
  return { db, user, account, campaign, graph, input, ruleInput, deps, dispatch, receive, route, tick, send, advance, now: () => now };
}
describe("campaign FAQ and human handoff", () => {
  beforeEach(async () => { await resetDb(); await seedCampaignConfig(); });
  it("uses actual incoming DM evidence, dedupes triple delivery and renders the latest FAQ once", async () => {
    const w = await world(); await Promise.all([w.receive("q1"), w.receive("q1"), w.receive("q1")]); expect(await w.route()).toEqual(["faq"]);
    const [rule] = await w.db.select().from(campaignFaqs);
    await saveCampaignFaq(w.db, w.user.id, { ...w.ruleInput, id: rule.id, expectedVersion: rule.version, requestId: randomUUID(), answer: "모레 발송합니다." }, w.now());
    await w.send(); expect(w.graph.messages).toHaveLength(1); expect(w.graph.messages[0].message.text).toBe("공구 자동 안내\n\n모레 발송합니다.");
    expect((await w.db.select().from(dmJobs))[0]).toMatchObject({ kind: "faq", status: "sent", faqRevisionUsed: 2 });
    expect((await w.db.select().from(campaignParticipants))[0].notificationRequestedAt).toBeNull();
    await w.receive("q2"); expect(await w.route()).toEqual(["faq_cooldown"]); expect(w.graph.dms).toHaveLength(0);
  });
  it("keeps readiness OFF, plan gates, exclusions and missing source consent from sending", async () => {
    const w = await world(false); await w.receive("q1"); await w.route(); expect(await w.db.select().from(dmJobs)).toHaveLength(0);
    await w.db.update(featureFlags).set({ enabled: true }).where(eq(featureFlags.key, FAQ_HANDOFF_FLAG)); await w.db.insert(featureFlagOverrides).values({ flagKey: FAQ_HANDOFF_FLAG, igAccountId: w.account.id, enabled: true });
    await w.receive("tap", { postback: true }); await w.receive("cancel", { text: "배송 취소" }); await w.receive("stale", { time: new Date(w.now().getTime() - 86_400_000) }); await w.route(); expect(await w.db.select().from(dmJobs)).toHaveLength(0);
    await setPlan(w.user.id, "free"); await w.receive("q3"); expect(await w.route()).toEqual(["entitlement"]); expect(w.graph.messages).toHaveLength(0);
    await expect(saveCampaignFaq(w.db, w.user.id, { ...w.ruleInput, requestId: randomUUID() }, w.now())).rejects.toMatchObject({ code: "entitlement" });
  });
  it("does not guess a campaign for a new sender or an unknown explicit reply", async () => {
    const w = await world(); const next = campaignWorld(w.account, "178800000000002"); const other = await saveCampaign(w.db, w.user.id, next.input, { now: CAMPAIGN_NOW, graph: next.graph, decrypt: decryptSecret, appUrl: w.deps.appUrl }); await publishCampaign(w.db, w.user.id, other.id, false, w.now());
    await w.receive("q1"); expect(await w.route()).toEqual(["ambiguous_faq_context"]);
    await w.receive("q2", { replyTo: "someone-elses-message" }); expect(await w.route()).toEqual(["ambiguous_faq_context"]); expect(await w.db.select().from(dmJobs)).toHaveLength(0);
  });
  it("blocks at echo ingress and cancels a seller-answered question instead of replaying after pause", async () => {
    const w = await world(); await w.receive("q1"); await w.route(); await w.tick(); w.advance(4000);
    await w.receive("seller-answer", { echo: true, text: "직접 답변" });
    expect((await w.db.select().from(conversationStates))[0].pendingEchoEventId).not.toBeNull(); expect(await w.tick()).toEqual(["held"]);
    expect(await w.route()).toEqual(["human_handoff"]); w.advance(5000); expect(await w.tick()).toEqual(["canceled"]); expect(w.graph.messages).toHaveLength(0);
    w.advance(1000); await w.receive("q2"); expect(await w.route()).toEqual(["human_handoff"]);
    w.advance(3_600_000); await w.receive("q3"); expect(await w.route()).toEqual(["faq"]); await w.send(); expect(w.graph.messages).toHaveLength(1);
  });
  it("does not mistake a Ringpo echo arriving before its HTTP result commit for a human reply", async () => {
    const w = await world(); await w.receive("q1"); await w.route(); await w.tick(); w.advance(4000);
    const [job] = await claimCampaignJobs(w.db, { batch: 1, now: w.now(), workerId: "echo-race" }); const prepared = await prepareCampaignSend(w.dispatch, job); if (typeof prepared === "string") throw new Error(prepared);
    const result = await invokePreparedSend(prepared, w.graph); if (result.state !== "accepted") throw new Error(result.state);
    await w.receive(result.providerMessageId, { echo: true }); expect(await w.route()).toEqual(["echo_send_pending"]);
    await settleCampaignSend(w.dispatch, prepared, result); w.advance(5000); expect(await w.route()).toEqual(["ringpo_echo"]);
    expect((await w.db.select().from(conversationStates))[0]).toMatchObject({ pendingEchoEventId: null, lastHumanAt: null, automationPausedUntil: null }); expect(w.graph.messages).toHaveLength(1);
  });
  it("keeps multiple echo reviews durable across worker restart and preserves manual handoff", async () => {
    const w = await world(); await w.receive("q1"); await w.route();
    await w.receive("human-1", { echo: true }); await w.receive("human-2", { echo: true }); const claimed = await claimMessageEvents(w.db, { batch: 1, now: w.now() });
    expect(await routeMessageEvent(w.deps, claimed[0])).toBe("human_handoff"); expect((await w.db.select().from(conversationStates))[0].pendingEchoEventId).not.toBeNull();
    await claimMessageEvents(w.db, { batch: 1, now: w.now() }); w.advance(61_000); await recoverMessageEvents(w.db, w.now()); await w.route(); expect((await w.db.select().from(conversationStates))[0].pendingEchoEventId).toBeNull();
    const [p] = await w.db.select().from(campaignParticipants); await setConversationPause(w.db, w.user.id, { campaignId: w.campaign.id, participantId: p.id, paused: false, requestId: randomUUID() }, w.now());
    await w.send(); expect(w.graph.messages).toHaveLength(0); expect((await w.db.select().from(dmJobs))[0].status).toBe("canceled");
  });
  it("checks ownership, version conflicts and disabled rule at dispatch; account deletion removes FAQ data", async () => {
    const w = await world(), stranger = await createUser(); const [rule] = await w.db.select().from(campaignFaqs);
    await expect(saveCampaignFaq(w.db, stranger.id, w.ruleInput, w.now())).rejects.toMatchObject({ code: "not_found" });
    await expect(campaignFaqOverview(w.db, stranger.id, w.campaign.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(saveCampaignFaq(w.db, w.user.id, { ...w.ruleInput, requestId: randomUUID(), id: rule.id, expectedVersion: 42 }, w.now())).rejects.toMatchObject({ code: "conflict" });
    await w.receive("q1"); await w.route(); await saveCampaignFaq(w.db, w.user.id, { ...w.ruleInput, requestId: randomUUID(), id: rule.id, expectedVersion: 1, enabled: false }, w.now()); await w.send(); expect(w.graph.messages).toHaveLength(0); expect((await w.db.select().from(dmJobs))[0].status).toBe("canceled");
    await w.db.delete(igAccounts).where(eq(igAccounts.id, w.account.id)); expect(await w.db.select().from(campaignFaqs)).toHaveLength(0); expect(await w.db.select().from(dmJobs)).toHaveLength(0); expect(await w.db.select().from(messageEvents)).toHaveLength(0);
  });
  it("refuses a queued FAQ when the source is deleted or account readiness is removed", async () => {
    const w = await world(); await w.receive("q1"); await w.route(); await w.receive("q1", { deleted: true }); await w.send(); expect(w.graph.messages).toHaveLength(0);
    w.advance(60_000); await w.receive("q2"); await w.route(); await w.db.update(featureFlags).set({ enabled: false }).where(eq(featureFlags.key, FAQ_HANDOFF_FLAG)); await w.send(); expect((await w.db.select().from(dmJobs)).some(j=>j.lastErrorCode==='faq_not_ready')).toBe(true); expect(w.graph.messages).toHaveLength(0);
  });
  it("does not extend an old question's deadline when a fresh unrelated DM opens a new window", async () => {
    const w = await world(); await w.receive("q1"); await w.route(); w.advance(86_400_000);
    await w.receive("fresh", { text: "고마워요" }); await w.send();
    expect(w.graph.messages).toHaveLength(0); expect((await w.db.select().from(dmJobs))[0].status).toBe("expired");
  });
  it("keeps an uncertain FAQ send for review and never retries it through repeated questions", async () => {
    const w = await world(); let calls = 0;
    w.graph.sendMessage = async () => { calls++; throw new GraphNetworkError("fixture lost response"); };
    await w.receive("q1"); await w.route(); await w.send(); expect(calls).toBe(1);
    expect((await w.db.select().from(dmJobs))[0].status).toBe("unknown");
    w.advance(61_000); await w.receive("q2"); expect(await w.route()).toEqual(["faq_response_pending"]); await w.send(); expect(calls).toBe(1);
  });
  it("lists earlier conversations with stable pagination and excludes another seller", async () => {
    const w = await world();
    for (let i = 0; i < 51; i++) {
      const peer = `peer-${i}`;
      await w.db.insert(campaignParticipants).values({ campaignId: w.campaign.id, igAccountId: w.account.id, commenterIgId: peer, recipientHash: i.toString(16).padStart(64, "0"), firstCommentCreatedAt: w.now() });
      await w.db.insert(conversationStates).values({ igAccountId: w.account.id, senderId: peer, lastUserInteractionAt: w.now() });
    }
    const page = await campaignFaqOverview(w.db, w.user.id, w.campaign.id); expect(page.conversations).toHaveLength(50);
    const next = await campaignFaqOverview(w.db, w.user.id, w.campaign.id, page.nextCursor!); expect(next.conversations).toHaveLength(1);
    expect(new Set([...page.conversations, ...next.conversations].map(c => c.participantId)).size).toBe(51);
    await expect(campaignFaqOverview(w.db, w.user.id, w.campaign.id, "invalid")).rejects.toMatchObject({ code: "validation" });
  });
});
