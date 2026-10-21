import { readFile } from "node:fs/promises";
import { getDb, getSql } from "@/server/db/client";
import { campaignInputSchema } from "@/lib/campaign-schema";
import { featureFlags, type IgAccount } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { CAMPAIGN_FLAG } from "@/server/campaigns/access";
import { FakeGraphClient } from "./fake-graph";

export const CAMPAIGN_NOW = new Date("2026-10-21T00:00:00Z");

export async function seedCampaignConfig(enabled = true) {
  const migration = await readFile("drizzle/0002_gonggu_foundation.sql", "utf8");
  const seed = migration.split("-- GONGGU_DEFAULTS\n")[1];
  if (!seed) throw new Error("campaign defaults migration missing");
  await getSql().unsafe(seed);
  if (enabled) await getDb().update(featureFlags).set({ enabled: true, defaultEnabled: true }).where(eq(featureFlags.key, CAMPAIGN_FLAG));
}

export function campaignWorld(account: IgAccount, mediaId = "178800000000001") {
  const graph = new FakeGraphClient();
  graph.media[mediaId] = { id: mediaId, caption: "공구", mediaType: "IMAGE", mediaProductType: "FEED", thumbnailUrl: null, mediaUrl: null, permalink: "https://instagram.com/p/test/", timestamp: CAMPAIGN_NOW, ownerId: account.igUserId };
  const input = {
    igAccountId: account.id, title: "수분 크림 공구", brand: "링포 브랜드",
    openAt: "2026-10-22T00:00:00Z", closeAt: "2026-10-24T00:00:00Z",
    linkKeywords: ["링크"], mediaIds: [mediaId],
    products: [{ name: "크림", option: "50ml", url: "https://shop.example.com/cream" }],
  };
  campaignInputSchema.parse(input);
  return { graph, input };
}
