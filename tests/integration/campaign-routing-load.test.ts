import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { campaignDeliveries, commentEvents, dmJobs, privateReplyClaims } from "@/server/db/schema";
import { decryptSecret } from "@/server/crypto";
import { saveCampaign, publishCampaign } from "@/server/campaigns/service";
import { claimCampaignEvents, routeCampaignEvent } from "@/server/campaigns/routing";
import { ingestComments } from "@/server/queue/ingest";
import { CAMPAIGN_NOW, campaignWorld, seedCampaignConfig } from "../helpers/campaigns";
import { FakeGraphClient } from "../helpers/fake-graph";
import { createIgAccount, createUser, setPlan } from "../helpers/factories";
import { resetDb } from "../helpers/db";

describe("250-account durable routing load", () => {
  beforeEach(async () => { await resetDb(); await seedCampaignConfig(); });

  it("persists 3,000 comments with three webhook deliveries and generates each pair of jobs once", async () => {
    const accounts = await Promise.all(Array.from({ length: 250 }, async () => {
      const user = await createUser(); const account = await createIgAccount(user.id); await setPlan(user.id, "pro");
      const fixture = campaignWorld(account);
      const campaign = await saveCampaign(getDb(), user.id, fixture.input, { now: CAMPAIGN_NOW, graph: fixture.graph, decrypt: decryptSecret, appUrl: "https://app.test" });
      await publishCampaign(getDb(), user.id, campaign.id, true, CAMPAIGN_NOW);
      return { account, mediaId: fixture.input.mediaIds[0] };
    }));
    const graph = new FakeGraphClient();
    const comments = Array.from({ length: 3000 }, (_, i) => {
      const { account, mediaId } = accounts[i % 250];
      const commentId = `900${i}`; const commenterIgId = `800${i}`;
      graph.comments[commentId] = { id: commentId, authorId: commenterIgId, mediaId, createdAt: new Date(CAMPAIGN_NOW.getTime() + i * 200) };
      return { igUserId: account.igUserId, commentId, mediaId, commenterIgId, text: "알림!!", parentCommentId: null, commenterUsername: null, mediaProductType: "FEED" };
    });
    const started = performance.now(); const intakeMs: number[] = []; let inserted = 0;
    // Advance simulated receipt time across ten minutes. No wall-clock/Meta throughput claim.
    for (let offset = 0; offset < comments.length; offset += 100) {
      const batch = comments.slice(offset, offset + 100); const now = new Date(CAMPAIGN_NOW.getTime() + (offset + 100) * 200);
      for (let delivery = 0; delivery < 3; delivery++) {
        const t = performance.now(); inserted += await ingestComments(getDb(), batch, now); intakeMs.push(performance.now() - t);
      }
    }
    const ingestMs = performance.now() - started;
    const routeStarted = performance.now(); const now = new Date(CAMPAIGN_NOW.getTime() + 600_000);
    let routed = 0;
    for (;;) {
      const batch = await claimCampaignEvents(getDb(), { batch: 32, now }); if (!batch.length) break;
      const outcomes = await Promise.all(batch.map((event) => routeCampaignEvent({ db: getDb(), graph, now: () => now, decryptToken: decryptSecret, hashKey: "local-load-test" }, event)));
      expect(outcomes.every((result) => result === "routed")).toBe(true); routed += outcomes.length;
    }
    const routingMs = performance.now() - routeStarted;
    const events = await getDb().select({ id: commentEvents.id }).from(commentEvents);
    const jobs = await getDb().select({ id: dmJobs.id, key: dmJobs.idempotencyKey, source: dmJobs.sourceEventId, channel: dmJobs.channel }).from(dmJobs);
    const privateJobs = jobs.filter((j) => j.channel === "private_reply");
    expect(inserted).toBe(3000); expect(events).toHaveLength(3000); expect(routed).toBe(3000);
    expect(jobs).toHaveLength(6000); expect(privateJobs).toHaveLength(3000);
    expect(new Set(privateJobs.map((j) => j.source))).toEqual(new Set(events.map((event) => event.id)));
    expect(new Set(jobs.map((j) => j.key)).size).toBe(6000);
    expect(await getDb().select().from(privateReplyClaims)).toHaveLength(3000);
    expect(await getDb().select().from(campaignDeliveries).where(eq(campaignDeliveries.intent, "initial_contact"))).toHaveLength(3000);
    expect(graph.dms).toHaveLength(0); expect(graph.commentReads).toBe(3000);
    intakeMs.sort((a, b) => a - b);
    const report = { scenario: "routing-250-accounts-3000-comments", measuredAt: new Date().toISOString(), accounts: 250, comments: 3000, webhookDeliveries: 9000, simulatedIntakeSeconds: 600, wallClockIntake: false, metadata: "in-process fixture, zero latency", poolSize: 10, routerConcurrency: 32, ingestMs: Math.round(ingestMs), routingMs: Math.round(routingMs), batchSize: 100, ingestP95Ms: Math.round(intakeMs[Math.ceil(intakeMs.length * .95) - 1]), jobs: jobs.length, missing: 0, duplicates: 0, externalMetaCalls: 0 };
    if (process.env.GONGGU_ROUTING_LOAD_REPORT) await writeFile(process.env.GONGGU_ROUTING_LOAD_REPORT, `${JSON.stringify(report, null, 2)}\n`);
  }, 120_000);
});
