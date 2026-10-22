import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/instagram/route";
import { saveCampaign, publishCampaign, advanceDueCampaigns } from "@/server/campaigns/service";
import { expireCampaignJobs, recoverCampaignJobs } from "@/server/campaigns/jobs";
import { expireMessageEvents, recoverMessageEvents } from "@/server/campaigns/message-inbox";
import { getCampaignReport } from "@/server/campaigns/report";
import { saveCampaignFaq } from "@/server/campaigns/faq-service";
import { FAQ_HANDOFF_FLAG } from "@/server/campaigns/faq-access";
import { queueCampaignAlerts } from "@/server/campaigns/operations";
import { getSendOverview } from "@/server/campaigns/send-controls";
import { decryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { campaigns, commentEvents, dmJobs, featureFlags, featureFlagOverrides, followGates, messageEvents, sendAttempts } from "@/server/db/schema";
import { setGraphClientForTesting } from "@/server/instagram/client";
import { createGraphClient, type CommentInfo } from "@/server/instagram/graph";
import { log } from "@/server/log";
import { processWithSharedBudget } from "@/server/pipeline/shared-budget";
import { claimEvents } from "@/server/queue/events";
import { startCampaignLoops } from "@/worker/campaign-loops";
import { startEventLoop } from "@/worker/loop";
import { campaignWorld, seedCampaignConfig } from "../helpers/campaigns";
import { resetDb } from "../helpers/db";
import { createAutomation, createIgAccount, createUser, setPlan } from "../helpers/factories";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
const p95 = (values: number[]) => values.toSorted((a, b) => a - b)[Math.max(0, Math.ceil(values.length * .95) - 1)] ?? 0;
function maxHour(values: number[]) { const times = values.toSorted((a, b) => a - b); let first = 0; let maximum = 0; for (let i = 0; i < times.length; i++) { while (times[i] - times[first] >= 3_600_000) first++; maximum = Math.max(maximum, i - first + 1); } return maximum; }

describe("opt-in mixed runtime load", () => {
  it.skipIf(process.env.GONGGU_RUNTIME_LOAD !== "1")("handles 250 accounts, 3,000 comments over ten real minutes, legacy follow-ups and dashboard reads", async () => {
    await resetDb(); await seedCampaignConfig(); const db = getDb();
    const m2 = process.env.GONGGU_RUNTIME_M2 === "1";
    if (m2) await db.update(featureFlags).set({ enabled: true }).where(eq(featureFlags.key, FAQ_HANDOFF_FLAG));
    const errors: string[] = []; const info = vi.spyOn(log, "info").mockImplementation(() => {});
    const errorLog = vi.spyOn(log, "error").mockImplementation((message) => { errors.push(message); });
    const metadata = new Map<string, CommentInfo>(); const writes: { key: string; at: number }[] = [];
    let requests = 0; let activeHttp = 0; let peakHttp = 0;
    const server = createServer(async (req, res) => {
      requests++; activeHttp++; peakHttp = Math.max(peakHttp, activeHttp);
      try {
        const url = new URL(req.url!, "http://fixture"); const id = url.pathname.split("/").at(-1)!;
        let response: object;
        if (req.method === "GET") {
          await sleep(100);
          if (url.searchParams.get("fields") === "is_user_follow_business") response = { is_user_follow_business: true };
          else { const comment = metadata.get(id); if (!comment) throw new Error("missing fixture comment"); response = { id, timestamp: comment.createdAt!.toISOString(), from: { id: comment.authorId }, media: { id: comment.mediaId } }; }
        } else {
          const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); const body = JSON.parse(Buffer.concat(chunks).toString());
          const key = body.recipient?.comment_id ? `private:${body.recipient.comment_id}` : body.recipient?.id ? `message:${body.recipient.id}` : `public:${url.pathname.split("/").at(-2)}`;
          writes.push({ key, at: Date.now() }); await sleep(1000); response = { id: `reply:${key}`, message_id: `mid:${key}` };
        }
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(response));
      } catch { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: 2, message: "fixture error" } })); }
      finally { activeHttp--; }
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); if (!address || typeof address === "string") throw new Error("fixture missing");
    const graph = createGraphClient({ version: "v26.0", fetchFn: (url, init) => { const parsed = new URL(String(url)); return fetch(`http://127.0.0.1:${address.port}${parsed.pathname}${parsed.search}`, init); } });
    setGraphClientForTesting(graph);
    const accounts: { user: Awaited<ReturnType<typeof createUser>>; account: Awaited<ReturnType<typeof createIgAccount>>; campaign: Awaited<ReturnType<typeof saveCampaign>>; mediaId: string }[] = [];
    for (let batch = 0; batch < 25; batch++) accounts.push(...await Promise.all(Array.from({ length: 10 }, async () => {
      const user = await createUser(); const account = await createIgAccount(user.id); await setPlan(user.id, "pro"); const fixture = campaignWorld(account); const now = new Date();
      const campaign = await saveCampaign(db, user.id, { ...fixture.input, openAt: new Date(now.getTime() + 3_600_000).toISOString(), closeAt: new Date(now.getTime() + 86_400_000).toISOString() }, { graph: fixture.graph, decrypt: decryptSecret, now, appUrl: "https://app.test" });
      await publishCampaign(db, user.id, campaign.id, true, now); await createAutomation(account, { followGate: true });
      if (m2) {
        await db.insert(featureFlagOverrides).values({ flagKey: FAQ_HANDOFF_FLAG, igAccountId: account.id, enabled: true });
        await saveCampaignFaq(db, user.id, { campaignId: campaign.id, requestId: randomUUID(), keywords: ["배송"], excludedKeywords: [], matchType: "contains", answer: "내일 배송합니다.", enabled: true, priority: 0 }, now);
      }
      return { user, account, campaign, mediaId: fixture.input.mediaIds[0] };
    })));
    const start = Date.now(); const openAt = new Date(start + 600_000); await db.update(campaigns).set({ openAt });
    const deps = { db, graph, decryptToken: decryptSecret, now: () => new Date(), random: () => 0, appUrl: "https://app.test", hashKey: "fixture", workerId: "mixed-load", sleep, hourlyLimit: 700 };
    const loops = startCampaignLoops(deps, { router: 32, sender: 64, inbox: 8 });
    const legacy = startEventLoop({ concurrency: 8, pollMs: 250, claim: (batch) => claimEvents(db, { batch, now: new Date() }), handle: async (event) => { await processWithSharedBudget(deps, event); }, onError: (error) => { errors.push(error instanceof Error ? error.name : "legacy error"); } });
    const intake: number[] = []; const dashboard: number[] = []; let dashboardSamples = 0; let reportSamples = 0; const reportLatency: number[] = []; let stop = false;
    const post = async (entry: object[]) => {
      const body = JSON.stringify({ object: "instagram", entry }); const sig = `sha256=${createHmac("sha256", process.env.IG_APP_SECRET!).update(body).digest("hex")}`; const began = performance.now();
      const response = await POST(new Request("http://localhost/api/webhooks/instagram", { method: "POST", body, headers: { "x-hub-signature-256": sig } }));
      expect(response.status).toBe(200); intake.push(performance.now() - began);
    };
    const commentEntry = (i: number, old = false) => {
      const a = accounts[i % 250]; const id = `${old ? "7" : "9"}${String(i).padStart(8, "0")}`; const peer = `${old ? "6" : "8"}${String(i).padStart(8, "0")}`; const mediaId = old ? "legacy-media" : a.mediaId;
      metadata.set(id, { id, authorId: peer, mediaId, createdAt: new Date() });
      return { id: a.account.igUserId, changes: [{ field: "comments", value: { id, from: { id: peer }, media: { id: mediaId, media_product_type: "FEED" }, text: old ? "공구" : "알림!!" } }] };
    };
    const maintenance = (async () => { while (!stop) { await advanceDueCampaigns(db, new Date()); await recoverCampaignJobs(db, new Date()); await recoverMessageEvents(db, new Date()); await expireCampaignJobs(db, new Date()); await expireMessageEvents(db, new Date()); if (m2) await queueCampaignAlerts(db, new Date()); await sleep(5000); } })();
    const dashboards = (async () => { let batch = 0; while (!stop) { const t = performance.now(); await Promise.all(Array.from({ length: 25 }, async (_, j) => { const a = accounts[(batch * 25 + j) % 250]; const began = performance.now(); await getSendOverview(db, a.user.id, a.account.id, a.campaign.id); dashboard.push(performance.now() - began); dashboardSamples++; if (m2 && j % 5 === 0) { const beganReport = performance.now(); await getCampaignReport(db, a.user.id, a.campaign.id); reportLatency.push(performance.now() - beganReport); reportSamples++; } })); batch++; await sleep(3000 - (performance.now() - t)); } })();
    const legacyTraffic = (async () => {
      for (let offset = 0; offset < 250; offset += 25) await post(Array.from({ length: 25 }, (_, j) => commentEntry(offset + j, true)));
      for (let wait = 0; ; wait++) {
        const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(commentEvents).where(eq(commentEvents.status, "awaiting_follow"));
        if (count.n === 250) break; if (wait > 180) throw new Error("legacy gates did not finish"); await sleep(1000);
      }
      const gates = await db.select().from(followGates);
      for (let offset = 0; offset < gates.length; offset += 25) {
        const entries = gates.slice(offset, offset + 25).map((gate) => { const i = accounts.findIndex((a) => a.account.id === gate.igAccountId); return { id: accounts[i].account.igUserId, messaging: [{ sender: { id: `6${String(i).padStart(8, "0")}` }, recipient: { id: accounts[i].account.igUserId }, timestamp: Date.now(), message: { mid: `legacy-response-${i}`, text: "팔로우했어요", quick_reply: { payload: `fg:${gate.id}` } } }] }; });
        await post(entries); await post(entries); await post(entries);
      }
    })();
    const faqTraffic = (async () => {
      if (!m2) return;
      await sleep(openAt.getTime() + 6000 - Date.now());
      await advanceDueCampaigns(db, new Date());
      for (let offset = 0; offset < 250; offset += 25) {
        const entries = accounts.slice(offset, offset + 25).map((a, j) => ({ id: a.account.igUserId, messaging: [{ sender: { id: `5${String(offset + j).padStart(8, "0")}` }, recipient: { id: a.account.igUserId }, timestamp: Date.now(), message: { mid: `faq-question-${offset + j}`, text: "배송 언제예요?" } }] }));
        await post(entries); await post(entries); await post(entries);
      }
    })();
    const expectedWrites = m2 ? 7000 : 6750;
    try {
      for (let second = 0; second < 600; second++) {
        await sleep(start + second * 1000 - Date.now()); const entries = Array.from({ length: 5 }, (_, j) => commentEntry(second * 5 + j));
        await post(entries); await post(entries); await post(entries);
        if (second % 60 === 0) console.log(JSON.stringify({ progress: "mixed-runtime", seconds: second, campaignComments: (second + 1) * 5, acceptedWrites: writes.length }));
      }
      await legacyTraffic; await faqTraffic;
      for (;;) {
        const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(dmJobs).where(and(eq(dmJobs.channel, "private_reply"), eq(dmJobs.status, "sent")));
        const [old] = await db.select({ n: sql<number>`count(*)::int` }).from(followGates).where(eq(followGates.status, "sent"));
        if (count.n === 3000 && old.n === 250 && writes.length === expectedWrites) break;
        if (Date.now() - start > 1_000_000) throw new Error(`mixed queue did not drain: campaign=${count.n}, legacy=${old.n}, writes=${writes.length}, errors=${errors.join(",")}`);
        await sleep(1000);
      }
      const attempts = await db.select().from(sendAttempts); const campaignPrivate = attempts.filter((a) => a.campaignId && a.channel === "private_reply" && a.state === "accepted");
      expect(errors).toEqual([]); expect(writes).toHaveLength(expectedWrites); expect(new Set(writes.map((w) => w.key)).size).toBe(expectedWrites);
      expect(attempts.filter((a) => ["sending", "unknown"].includes(a.state))).toEqual([]);
      expect(await db.select().from(dmJobs).where(inArray(dmJobs.status, ["waiting", "leased", "sending", "retry", "unknown", "failed"]))).toHaveLength(0);
      expect(await db.select().from(messageEvents).where(inArray(messageEvents.status, ["pending", "leased", "failed", "send_unknown"]))).toHaveLength(0);
      expect(campaignPrivate.every((a) => a.invokedAt! >= openAt)).toBe(true);
      const observed = { private_reply: 0, public_reply: 0, message: 0 };
      for (const a of accounts) for (const channel of ["private_reply", "public_reply", "message"] as const) observed[channel] = Math.max(observed[channel], maxHour(attempts.filter((s) => s.igAccountId === a.account.id && s.channel === channel && s.invokedAt).map((s) => s.invokedAt!.getTime())));
      expect(observed.private_reply).toBeLessThanOrEqual(400); expect(observed.public_reply).toBeLessThanOrEqual(120); expect(observed.message).toBeLessThanOrEqual(400);
      const completionMs = Math.max(...campaignPrivate.map((a) => a.finishedAt!.getTime())) - openAt.getTime();
      const report = { scenario: m2 ? "m2-mixed-runtime-250-accounts" : "mixed-runtime-250-accounts", faqFlows: m2 ? 250 : 0, reportSamples, reportP95Ms: Math.round(p95(reportLatency)), measuredAt: new Date().toISOString(), accounts: 250, campaignComments: 3000, intakeDurationMs: 600_000, legacyFollowFlows: 250, privateJobs: 3000, publicJobs: 3000, ordinaryLegacyLinks: 250, acceptedWrites: writes.length, missing: 0, duplicates: 0, unknown: 0, observedRollingHour: observed, openPrivateCompletionMs: completionMs, expectedPrivateMs: 108_000, privateEtaErrorMs: completionMs - 108_000, httpWriteDelayMs: 1000, httpReadDelayMs: 100, fixtureHttpRequests: requests, peakHttp, poolSize: 10, routerConcurrency: 32, senderConcurrency: 64, inboxConcurrency: 8, legacyConcurrency: 8, dashboardSamples, dashboardP95Ms: Math.round(p95(dashboard)), webhookP95Ms: Math.round(p95(intake)), errors, externalMetaCalls: 0, wallMs: Date.now() - start };
      if (process.env.GONGGU_RUNTIME_LOAD_REPORT) await writeFile(process.env.GONGGU_RUNTIME_LOAD_REPORT, `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify(report));
    } finally {
      stop = true; await Promise.allSettled([maintenance, dashboards, legacyTraffic, faqTraffic]); await Promise.all([loops.stop(), legacy.stop()]);
      await new Promise<void>((resolve) => server.close(() => resolve())); setGraphClientForTesting(null); info.mockRestore(); errorLog.mockRestore();
    }
  }, 1_200_000);
});
