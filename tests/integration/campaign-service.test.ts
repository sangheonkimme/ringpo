import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { campaigns, campaignMedia, campaignAuditEvents, campaignProducts, featureFlags, featureFlagOverrides, planEntitlements, igAccounts } from "@/server/db/schema";
import { decryptSecret } from "@/server/crypto";
import { CAMPAIGN_FLAG, campaignsEnabled } from "@/server/campaigns/access";
import { advanceDueCampaigns, archiveCampaign, getCampaign, listCampaigns, publishCampaign, saveCampaign, transitionCampaign } from "@/server/campaigns/service";
import { CAMPAIGN_NOW, campaignWorld, seedCampaignConfig } from "../helpers/campaigns";
import { resetDb } from "../helpers/db";
import { createIgAccount, createUser, setPlan } from "../helpers/factories";

async function world(mediaId?: string) {
  const user = await createUser();
  const account = await createIgAccount(user.id);
  const fixture = campaignWorld(account, mediaId);
  const options = { now: CAMPAIGN_NOW, appUrl: "https://app.test", graph: fixture.graph, decrypt: decryptSecret };
  return { user, account, ...fixture, options, create: () => saveCampaign(getDb(), user.id, fixture.input, options) };
}

describe("campaign foundation", () => {
  beforeEach(async () => { await resetDb(); await seedCampaignConfig(); });

  it("honors the global kill switch over cohort overrides and defaults off without configuration", async () => {
    const w = await world();
    await getDb().update(featureFlags).set({ enabled: true, defaultEnabled: false });
    expect(await campaignsEnabled(getDb(), w.account.id)).toBe(false);
    await getDb().insert(featureFlagOverrides).values({ flagKey: CAMPAIGN_FLAG, igAccountId: w.account.id, enabled: true });
    expect(await campaignsEnabled(getDb(), w.account.id)).toBe(true);
    await getDb().update(featureFlags).set({ enabled: false });
    expect(await campaignsEnabled(getDb(), w.account.id)).toBe(false);
    await expect(w.create()).rejects.toMatchObject({ code: "disabled" });
    await getDb().delete(featureFlags);
    expect(await campaignsEnabled(getDb(), w.account.id)).toBe(false);
  });

  it("creates a draft with products, owned media and configured rate without publishing", async () => {
    const w = await world(); const campaign = await w.create();
    expect(campaign).toMatchObject({ status: "draft", publishedAt: null, hourlyRate: 400 });
    expect(await advanceDueCampaigns(getDb(), new Date("2026-10-25T00:00:00Z"))).toBe(0);
    const saved = await getCampaign(getDb(), w.user.id, campaign.id);
    expect(saved?.products).toHaveLength(1); expect(saved?.media[0].routingEnabled).toBe(false);
    expect(saved?.audit).toHaveLength(1);
    expect(await getCampaign(getDb(), "someone-else", campaign.id)).toBeNull();
  });

  it("rejects foreign accounts/media, unknown owner, unsupported media and unsafe URLs", async () => {
    const w = await world(); const stranger = await createUser();
    await expect(saveCampaign(getDb(), stranger.id, w.input, w.options)).rejects.toMatchObject({ code: "not_found" });
    const media = w.graph.media[w.input.mediaIds[0]];
    media.ownerId = "another-account";
    await expect(w.create()).rejects.toMatchObject({ code: "media_owner" });
    delete media.ownerId;
    await expect(w.create()).rejects.toMatchObject({ code: "media_owner" });
    media.ownerId = w.account.igUserId; media.mediaProductType = "STORY";
    await expect(w.create()).rejects.toMatchObject({ code: "media_owner" });
    media.mediaProductType = "FEED";
    await expect(saveCampaign(getDb(), w.user.id, { ...w.input, products: [{ name: "bad", url: "javascript:alert(1)" }] }, w.options)).rejects.toMatchObject({ code: "validation" });
    await expect(saveCampaign(getDb(), w.user.id, { ...w.input, products: [{ name: "bad", url: "https://app.test/l/abc1234" }] }, w.options)).rejects.toMatchObject({ code: "validation" });
    expect(await listCampaigns(getDb(), w.user.id)).toHaveLength(0);
  });

  it("serializes concurrent Free publication even for different IG accounts", async () => {
    const w = await world(); const a = await w.create();
    const account2 = await createIgAccount(w.user.id); const f = campaignWorld(account2, "178800000000002");
    const b = await saveCampaign(getDb(), w.user.id, f.input, { ...w.options, graph: f.graph });
    const results = await Promise.allSettled([a, b].map((c) => publishCampaign(getDb(), w.user.id, c.id, false, CAMPAIGN_NOW)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toMatchObject([{ reason: { code: "active_limit" } }]);
  });

  it("changes limits and paid features through entitlements only", async () => {
    const w = await world();
    await expect(saveCampaign(getDb(), w.user.id, { ...w.input, followOnly: true }, w.options)).rejects.toMatchObject({ code: "entitlement" });
    const a = await w.create();
    await expect(publishCampaign(getDb(), w.user.id, a.id, true, CAMPAIGN_NOW)).rejects.toMatchObject({ code: "entitlement" });
    await getDb().update(planEntitlements).set({ booleanValue: true }).where(and(eq(planEntitlements.plan, "free"), eq(planEntitlements.key, "campaign.scheduled_dm")));
    expect((await publishCampaign(getDb(), w.user.id, a.id, true, CAMPAIGN_NOW)).status).toBe("teaser");
    await getDb().update(planEntitlements).set({ limitValue: null }).where(and(eq(planEntitlements.plan, "free"), eq(planEntitlements.key, "campaign.max_active")));
    const f = campaignWorld(w.account, "178800000000003");
    const b = await saveCampaign(getDb(), w.user.id, f.input, { ...w.options, graph: f.graph });
    await expect(publishCampaign(getDb(), w.user.id, b.id, false, CAMPAIGN_NOW)).resolves.toMatchObject({ publishedAt: CAMPAIGN_NOW });
  });

  it("prevents simultaneous media ownership even with unlimited Pro campaigns", async () => {
    const w = await world(); await setPlan(w.user.id, "pro");
    const [a, b] = await Promise.all([w.create(), w.create()]);
    const results = await Promise.allSettled([a, b].map((c) => publishCampaign(getDb(), w.user.id, c.id, true, CAMPAIGN_NOW)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toMatchObject([{ reason: { code: "media_conflict" } }]);
  });

  it("is idempotent across duplicate schedulers and catches up opening and closing after downtime", async () => {
    const w = await world(); const a = await w.create(); await publishCampaign(getDb(), w.user.id, a.id, false, CAMPAIGN_NOW);
    const counts = await Promise.all([1, 2, 3].map(() => advanceDueCampaigns(getDb(), new Date("2026-10-25T00:00:00Z"))));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
    const c = await getCampaign(getDb(), w.user.id, a.id);
    expect(c?.status).toBe("closed"); expect(c?.openedAt?.toISOString()).toBe("2026-10-25T00:00:00.000Z");
    expect(c?.audit.find((a) => a.toState === "open")?.effectiveAt).toEqual(new Date(w.input.openAt));
    expect(c?.audit.filter((a) => a.action === "transition")).toHaveLength(2);
  });

  it("holds scheduled transitions while the flag is off and resumes them when re-enabled", async () => {
    const w = await world(); const a = await w.create(); await publishCampaign(getDb(), w.user.id, a.id, false, CAMPAIGN_NOW);
    await getDb().update(featureFlags).set({ enabled: false });
    expect(await advanceDueCampaigns(getDb(), new Date(w.input.openAt))).toBe(0);
    expect((await getDb().select().from(campaigns))[0].status).toBe("draft");
    await getDb().update(featureFlags).set({ enabled: true });
    expect(await advanceDueCampaigns(getDb(), new Date(w.input.openAt))).toBe(1);
  });

  it("audits manual early opening, deduplicates request IDs and rejects stale or backward transitions", async () => {
    const w = await world(); const a = await w.create(); const published = await publishCampaign(getDb(), w.user.id, a.id, false, CAMPAIGN_NOW);
    const opts = { now: CAMPAIGN_NOW, requestId: randomUUID(), expectedVersion: published.version, reason: "조기 오픈" };
    const opened = await transitionCampaign(getDb(), w.user.id, a.id, "open", opts);
    expect(opened.openedAt).toEqual(CAMPAIGN_NOW);
    expect((await transitionCampaign(getDb(), w.user.id, a.id, "open", opts)).version).toBe(opened.version);
    await expect(transitionCampaign(getDb(), w.user.id, a.id, "sold_out", opts)).rejects.toMatchObject({ code: "request_conflict" });
    await expect(transitionCampaign(getDb(), w.user.id, a.id, "sold_out", { ...opts, requestId: randomUUID() })).rejects.toMatchObject({ code: "conflict" });
    const sold = await transitionCampaign(getDb(), w.user.id, a.id, "sold_out", { ...opts, requestId: randomUUID(), expectedVersion: opened.version });
    await expect(transitionCampaign(getDb(), w.user.id, a.id, "open", { ...opts, requestId: randomUUID(), expectedVersion: sold.version })).rejects.toMatchObject({ code: "transition" });
  });

  it("atomically edits products, refuses stale edits and archives to release media", async () => {
    const w = await world(); const a = await w.create(); const details = await getCampaign(getDb(), w.user.id, a.id);
    const updated = await saveCampaign(getDb(), w.user.id, { ...w.input, title: "수정", products: [{ ...w.input.products[0], id: details!.products[0].id, option: "100ml" }] }, { ...w.options, id: a.id, expectedVersion: a.version });
    expect(updated.version).toBe(2);
    await expect(saveCampaign(getDb(), w.user.id, w.input, { ...w.options, id: a.id, expectedVersion: 1 })).rejects.toMatchObject({ code: "conflict" });
    expect(await getDb().select().from(campaignProducts).where(eq(campaignProducts.campaignId, a.id))).toHaveLength(1);
    await publishCampaign(getDb(), w.user.id, a.id, false, CAMPAIGN_NOW);
    await archiveCampaign(getDb(), w.user.id, a.id, CAMPAIGN_NOW);
    expect(await getCampaign(getDb(), w.user.id, a.id)).toBeNull();
    expect((await getDb().select().from(campaignMedia))[0].routingEnabled).toBe(false);
    expect(await listCampaigns(getDb(), w.user.id)).toHaveLength(0);
  });

  it("cascades campaign data with account deletion", async () => {
    const w = await world(); await w.create();
    await getDb().delete(igAccounts).where(eq(igAccounts.id, w.account.id));
    for (const table of [campaigns, campaignProducts, campaignMedia, campaignAuditEvents]) expect(await getDb().select().from(table)).toHaveLength(0);
  });
});
