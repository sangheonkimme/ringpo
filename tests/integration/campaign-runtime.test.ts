import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/instagram/route";
import { saveCampaign, publishCampaign } from "@/server/campaigns/service";
import { decryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { dmJobs, featureFlags, messageEvents, sendAttempts } from "@/server/db/schema";
import { setGraphClientForTesting } from "@/server/instagram/client";
import { startCampaignLoops } from "@/worker/campaign-loops";
import { campaignWorld, seedCampaignConfig } from "../helpers/campaigns";
import { resetDb } from "../helpers/db";
import { createIgAccount, createUser, setPlan } from "../helpers/factories";

async function webhook(value: unknown) {
  const body = JSON.stringify(value); const signature = `sha256=${createHmac("sha256", process.env.IG_APP_SECRET!).update(body).digest("hex")}`;
  return POST(new Request("http://localhost/api/webhooks/instagram", { method: "POST", body, headers: { "x-hub-signature-256": signature } }));
}
async function until(predicate: () => Promise<boolean>, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() >= deadline) throw new Error("worker did not finish fixture within deadline"); await new Promise((resolve) => setTimeout(resolve, 50)); }
}

describe("signed webhook and production worker loops", () => {
  beforeEach(async () => { await resetDb(); await seedCampaignConfig(); });
  afterEach(() => setGraphClientForTesting(null));
  it("durably accepts repeated comments and replies, then sends one gate and one authorized link through the real loops", async () => {
    const db = getDb(); const user = await createUser(); await setPlan(user.id, "pro"); const account = await createIgAccount(user.id);
    const { graph, input } = campaignWorld(account); setGraphClientForTesting(graph);
    const now = new Date(); const campaign = await saveCampaign(db, user.id, { ...input, followOnly: true, openAt: new Date(now.getTime() + 1000).toISOString(), closeAt: new Date(now.getTime() + 86_400_000).toISOString() }, { graph, decrypt: decryptSecret, now, appUrl: "https://app.test" });
    await publishCampaign(db, user.id, campaign.id, true, new Date(now.getTime() + 1000));
    graph.comments["runtime-comment"] = { id: "runtime-comment", authorId: "900", mediaId: input.mediaIds[0], createdAt: now };
    const comment = { object: "instagram", entry: [{ id: account.igUserId, changes: [{ field: "comments", value: { id: "runtime-comment", from: { id: "900", username: "fixture" }, media: { id: input.mediaIds[0], media_product_type: "FEED" }, text: "링크" } }] }] };
    for (let i = 0; i < 3; i++) expect((await webhook(comment)).status).toBe(200);
    expect(graph.commentReads).toBe(0); expect(graph.dms).toHaveLength(0);
    const start = () => startCampaignLoops({ db, graph, decryptToken: decryptSecret, now: () => new Date(), random: () => 0, appUrl: "https://app.test", hashKey: "fixture", workerId: "runtime-fixture" }, { router: 2, sender: 4, inbox: 2 });
    let loops = start();
    try {
      await until(async () => (await db.select().from(dmJobs).where(and(eq(dmJobs.kind, "follow_request"), eq(dmJobs.status, "sent")))).length === 1);
      expect(graph.dms).toHaveLength(1); expect(graph.followReads).toBe(0);
      await loops.stop();
      // Inbox persists while sender is disabled; reopening workers/flag must not require webhook replay.
      await db.update(featureFlags).set({ enabled: false }); graph.followers.add("900");
      const message = { object: "instagram", entry: [{ id: account.igUserId, messaging: [{ sender: { id: "900" }, recipient: { id: account.igUserId }, timestamp: Date.now(), message: { mid: "runtime-response", text: "팔로우했어요" } }] }] };
      for (let i = 0; i < 3; i++) expect((await webhook(message)).status).toBe(200);
      expect(await db.select().from(messageEvents)).toHaveLength(1); expect(graph.messages).toHaveLength(0);
      await db.update(featureFlags).set({ enabled: true });
      loops = start();
      await until(async () => (await db.select().from(dmJobs).where(and(eq(dmJobs.kind, "follow_link"), eq(dmJobs.status, "sent")))).length === 1);
      expect(graph.messages).toHaveLength(1); expect(graph.messages[0].message).toMatchObject({ kind: "button", url: expect.stringContaining("/r/") });
      expect((await db.select().from(sendAttempts)).filter((a) => ["sending", "unknown"].includes(a.state))).toEqual([]);
    } finally { await loops.stop(); }
  });
});
