import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getCampaignForecast } from "@/server/campaigns/forecast";
import { claimCampaignEvents, routeCampaignEvent } from "@/server/campaigns/routing";
import { publishCampaign, saveCampaign } from "@/server/campaigns/service";
import { decryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { accountSendControls, campaigns, dmJobs, featureFlags, igAccounts } from "@/server/db/schema";
import { ingestComments } from "@/server/queue/ingest";
import { campaignWorld, CAMPAIGN_NOW, seedCampaignConfig } from "../helpers/campaigns";
import { resetDb } from "../helpers/db";
import { createIgAccount, createUser, setPlan } from "../helpers/factories";

async function world() {
  const db = getDb(); const user = await createUser(); const account = await createIgAccount(user.id); await setPlan(user.id, "pro");
  const { graph, input } = campaignWorld(account);
  const openAt = new Date(CAMPAIGN_NOW.getTime() + 2 * 86_400_000); const closeAt = new Date(CAMPAIGN_NOW.getTime() + 3 * 86_400_000);
  const campaign = await saveCampaign(db, user.id, { ...input, openAt: openAt.toISOString(), closeAt: closeAt.toISOString() }, { graph, decrypt: decryptSecret, now: CAMPAIGN_NOW, appUrl: "https://app.test" });
  await publishCampaign(db, user.id, campaign.id, true, CAMPAIGN_NOW);
  for (const id of ["one", "two"]) {
    graph.comments[id] = { id, authorId: `person-${id}`, mediaId: input.mediaIds[0], createdAt: new Date(CAMPAIGN_NOW.getTime() - 6 * 86_400_000) };
    await ingestComments(db, [{ igUserId: account.igUserId, commentId: id, commenterIgId: `person-${id}`, commenterUsername: null, mediaId: input.mediaIds[0], mediaProductType: "FEED", parentCommentId: null, text: "알림" }], CAMPAIGN_NOW);
  }
  for (const event of await claimCampaignEvents(db, { batch: 10, now: CAMPAIGN_NOW })) await routeCampaignEvent({ db, graph, now: () => CAMPAIGN_NOW, decryptToken: decryptSecret, hashKey: "fixture" }, event);
  return { db, user, account, campaign, timing: { openAt, closeAt, hourlyRate: 400, expiryFallbackEnabled: false }, preview: (proposed?: { openAt: Date; closeAt: Date; hourlyRate: number; expiryFallbackEnabled: boolean }) => getCampaignForecast(db, user.id, account.id, campaign.id, proposed, CAMPAIGN_NOW) };
}

describe("authorized campaign forecast and edit preview", () => {
  beforeEach(async () => { await resetDb(); await seedCampaignConfig(); });

  it("uses Meta creation deadlines, not the recent receipt time, and previews fallback without mutating jobs", async () => {
    const w = await world(); const before = await w.db.select().from(dmJobs);
    const saved = await w.preview(); expect(saved).toMatchObject({ waiting: 2, scheduleRisk: 2, queueRisk: 2, expiredExpected: 2, fallbackExpected: 0, completionAt: null });
    const preview = await w.preview({ ...w.timing, expiryFallbackEnabled: true });
    expect(preview).toMatchObject({ waiting: 2, scheduleRisk: 2, fallbackExpected: 2, expiredExpected: 0 });
    expect(new Date(preview.completionAt!).getTime()).toBeLessThan(w.timing.openAt.getTime());
    expect(await w.db.select().from(dmJobs)).toEqual(before);
    expect((await w.db.select().from(campaigns))[0].expiryFallbackEnabled).toBe(false);
    expect(JSON.stringify(preview)).not.toContain("person-one"); expect(JSON.stringify(preview)).not.toContain(w.account.igUserId);
  });

  it("shows the risk from a fallback burst that cannot fit inside the remaining one-hour window", async () => {
    const w = await world();
    expect(await w.preview({ ...w.timing, hourlyRate: 1, expiryFallbackEnabled: true })).toMatchObject({ fallbackExpected: 1, expiredExpected: 1, effectiveHourlyRate: 1 });
  });

  it("updates risk for an earlier opening while keeping the original deadline and schedule in storage", async () => {
    const w = await world(); const before = await w.db.select().from(dmJobs);
    const preview = await w.preview({ ...w.timing, openAt: new Date(CAMPAIGN_NOW.getTime() + 3_600_000) });
    expect(preview.scheduleRisk).toBe(0); expect(preview.queueRisk).toBe(0); expect(preview.expiredExpected).toBe(0);
    expect(await w.db.select().from(dmJobs)).toEqual(before);
  });

  it("withholds a promised completion on manual pause and still allows the owner to see a disconnected account", async () => {
    const w = await world(); await w.db.update(accountSendControls).set({ manualPaused: true }).where(eq(accountSendControls.igAccountId, w.account.id));
    expect(await w.preview()).toMatchObject({ blockedReason: "manual_pause", scheduleRisk: 2, queueRisk: null, completionAt: null });
    await w.db.update(accountSendControls).set({ manualPaused: false }).where(eq(accountSendControls.igAccountId, w.account.id));
    await w.db.update(igAccounts).set({ status: "reauth_required" }).where(eq(igAccounts.id, w.account.id));
    expect(await w.preview()).toMatchObject({ blockedReason: "account_inactive", completionAt: null });
  });

  it("rejects another owner, another account's campaign, invalid timing and flag OFF", async () => {
    const w = await world(); const other = await createUser(); const account = await createIgAccount(other.id);
    await expect(getCampaignForecast(w.db, other.id, w.account.id, w.campaign.id, undefined, CAMPAIGN_NOW)).rejects.toMatchObject({ code: "not_found" });
    await expect(getCampaignForecast(w.db, other.id, account.id, w.campaign.id, undefined, CAMPAIGN_NOW)).rejects.toMatchObject({ code: "not_found" });
    await expect(w.preview({ ...w.timing, openAt: w.timing.closeAt })).rejects.toMatchObject({ code: "validation" });
    await w.db.update(featureFlags).set({ enabled: false }); await expect(w.preview()).rejects.toMatchObject({ code: "not_found" });
  });

  it("shows zero received requests on a new draft instead of estimating invented future comments", async () => {
    const w = await world();
    expect(await getCampaignForecast(w.db, w.user.id, w.account.id, undefined, w.timing, CAMPAIGN_NOW)).toMatchObject({ waiting: 0, scheduleRisk: 0, completionAt: null, nominalCompletionAt: null });
  });
});
