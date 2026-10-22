import { randomUUID } from "node:crypto";
import { getDb } from "@/server/db/client";
import { reportSnapshots } from "@/server/db/schema";
import { saveCampaign } from "@/server/campaigns/service";
import { decryptSecret } from "@/server/crypto";
import { campaignWorld } from "./campaigns";
import { createIgAccount, createUser, setPlan } from "./factories";
import { reportData } from "./report-data";

export async function reportSharingWorld() {
  const db = getDb(); const user = await createUser(); const account = await createIgAccount(user.id); await setPlan(user.id, "pro");
  const { graph, input } = campaignWorld(account); const now = new Date();
  const campaign = await saveCampaign(db, user.id, { ...input, openAt: new Date(+now + 86_400_000).toISOString(), closeAt: new Date(+now + 3 * 86_400_000).toISOString() }, { graph, decrypt: decryptSecret, now, appUrl: "http://localhost:3000" });
  const [snapshot] = await db.insert(reportSnapshots).values({ campaignId: campaign.id, sourceKey: randomUUID(), revision: 1, asOf: now, finalized: true, data: reportData() }).returning();
  const shareInput = { campaignId: campaign.id, snapshotId: snapshot.id, requestId: randomUUID(), reviewedPublicContent: true, pdfEnabled: true, expiresAt: null };
  return { db, user, account, campaign, snapshot, shareInput, now };
}
