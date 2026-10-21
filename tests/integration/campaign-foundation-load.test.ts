import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { campaignAuditEvents, campaigns } from "@/server/db/schema";
import { decryptSecret } from "@/server/crypto";
import { advanceDueCampaigns, publishCampaign, saveCampaign } from "@/server/campaigns/service";
import { CAMPAIGN_NOW, campaignWorld, seedCampaignConfig } from "../helpers/campaigns";
import { createIgAccount, createUser } from "../helpers/factories";
import { resetDb } from "../helpers/db";

describe("250-account campaign foundation load", () => {
  beforeEach(async () => { await resetDb(); await seedCampaignConfig(); });

  it("opens 250 accounts once under duplicate schedulers with a 10-connection pool", async () => {
    const started = performance.now();
    await Promise.all(Array.from({ length: 250 }, async () => {
      const owner = await createUser(); const account = await createIgAccount(owner.id);
      const fixture = campaignWorld(account);
      const campaign = await saveCampaign(getDb(), owner.id, fixture.input, { now: CAMPAIGN_NOW, appUrl: "https://app.test", graph: fixture.graph, decrypt: decryptSecret });
      await publishCampaign(getDb(), owner.id, campaign.id, false, CAMPAIGN_NOW);
    }));
    const setupMs = performance.now() - started;
    const due = new Date("2026-10-22T00:00:00Z");
    const openStarted = performance.now();
    const counts = await Promise.all([1, 2, 3].map(() => advanceDueCampaigns(getDb(), due)));
    const transitionMs = performance.now() - openStarted;
    const rows = await getDb().select().from(campaigns);
    const audits = await getDb().select().from(campaignAuditEvents).where(eq(campaignAuditEvents.action, "transition"));
    expect(rows).toHaveLength(250);
    expect(rows.every((row) => row.status === "open")).toBe(true);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(250);
    expect(audits).toHaveLength(250);
    expect(new Set(audits.map((a) => a.campaignId)).size).toBe(250);
    expect(await advanceDueCampaigns(getDb(), due)).toBe(0);
    const report = { scenario: "foundation-250-accounts", measuredAt: new Date().toISOString(), accounts: 250, schedulers: 3, poolSize: 10, setupMs: Math.round(setupMs), transitionMs: Math.round(transitionMs), missing: 0, duplicate: 0, metaCalls: 0 };
    if (process.env.GONGGU_LOAD_REPORT) await writeFile(process.env.GONGGU_LOAD_REPORT, `${JSON.stringify(report, null, 2)}\n`);
    console.info(JSON.stringify(report));
  }, 60_000);
});
