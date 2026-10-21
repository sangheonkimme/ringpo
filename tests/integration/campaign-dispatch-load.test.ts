import { createServer } from "node:http";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { and, eq, inArray, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { campaigns, dmJobs, sendAttempts } from "@/server/db/schema";
import { decryptSecret } from "@/server/crypto";
import { dispatchCampaignJob, type DispatchDeps } from "@/server/campaigns/dispatch";
import { claimCampaignJobs } from "@/server/campaigns/jobs";
import { createGraphClient } from "@/server/instagram/graph";
import { startEventLoop } from "@/worker/loop";
import { resetDb } from "../helpers/db";
import { CAMPAIGN_NOW, seedCampaignConfig } from "../helpers/campaigns";
import { seedDispatchLoad } from "../helpers/campaign-dispatch";
import { FakeGraphClient } from "../helpers/fake-graph";

async function drain(deps: DispatchDeps, start: Date, realtime = false) {
  let now = start; let rounds = 0;
  if (!realtime) deps.clock = async () => now;
  for (;;) {
    if (++rounds > 20_000) throw new Error("Queue did not drain");
    if (realtime) now = new Date();
    const jobs = await claimCampaignJobs(deps.db, { batch: 64, now, workerId: `load-${rounds % 3}` });
    if (jobs.length) { await Promise.all(jobs.map((job) => dispatchCampaignJob(deps, job))); continue; }
    const rows = await deps.db.execute<{ at: string | null }>(sql`select min(greatest(j.next_attempt_at, b.next_eligible_at)) as at from dm_jobs j join send_buckets b on b.ig_account_id = j.ig_account_id and b.channel = j.channel where j.status in ('waiting','retry')`);
    const dueAt = rows[0].at;
    if (!dueAt) break;
    if (realtime) { await new Promise((resolve) => setTimeout(resolve, Math.max(10, Math.min(1000, new Date(dueAt).getTime() - Date.now())))); continue; }
    now = new Date(Math.max(now.getTime() + 1, new Date(dueAt).getTime()));
  }
  return now;
}

function maxRollingHour(times: number[]) {
  times.sort((a, b) => a - b); let first = 0; let maximum = 0;
  for (let i = 0; i < times.length; i++) { while (times[i] - times[first] >= 3_600_000) first++; maximum = Math.max(maximum, i - first + 1); }
  return maximum;
}

async function drainContinuously(deps: DispatchDeps, expected: number) {
  let accepted = 0; let resolve!: () => void; let reject!: (error: unknown) => void;
  const done = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const loop = startEventLoop({ concurrency: 64, pollMs: 250,
    claim: (batch) => claimCampaignJobs(deps.db, { batch, now: new Date(), workerId: "realtime-worker" }),
    handle: async (job) => {
      const outcome = await dispatchCampaignJob(deps, job);
      if (outcome === "sent" && ++accepted === expected) resolve();
      if (["unknown", "failed", "expired", "canceled"].includes(outcome)) reject(new Error(`Unexpected terminal outcome: ${outcome}`));
    }, onError: reject,
  });
  try { await done; return new Date(); } finally { await loop.stop(); }
}

describe("dispatch load and rolling-hour safety", () => {
  beforeEach(async () => { await resetDb(); await seedCampaignConfig(); });

  it("sends 3,000 queued jobs across 250 accounts through a local delayed HTTP API without loss or duplicates", async () => {
    const realtime = process.env.GONGGU_DISPATCH_REALTIME === "1";
    const continuous = realtime && process.env.GONGGU_DISPATCH_CONTINUOUS === "1";
    const includePublic = process.env.GONGGU_DISPATCH_PUBLIC === "1";
    const httpDelayMs = Number(process.env.GONGGU_DISPATCH_HTTP_DELAY_MS ?? 100);
    let start = realtime ? new Date() : CAMPAIGN_NOW;
    const db = getDb(); const fixture = await seedDispatchLoad(250, 3000, start, 400, includePublic);
    const received: string[] = []; let connections = 0; let peakConnections = 0;
    const server = createServer(async (req, res) => {
      connections++; peakConnections = Math.max(peakConnections, connections);
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const key = body.recipient ? `private:${body.recipient.comment_id}` : `public:${req.url!.split("/").at(-2)}`;
      received.push(key);
      await new Promise((resolve) => setTimeout(resolve, httpDelayMs));
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: `load-reply-${key}`, message_id: `load-mid-${key}` })); connections--;
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing fixture port");
    const graph = createGraphClient({ version: "v26.0", fetchFn: (url, init) => fetch(`http://127.0.0.1:${address.port}${new URL(String(url)).pathname}`, init) });
    const deps: DispatchDeps = { db, graph, decryptToken: decryptSecret, random: () => 0, render: async () => ({ kind: "text", text: "fixture link" }) };
    if (realtime) {
      start = new Date();
      await db.update(campaigns).set({ openAt: start });
      await db.update(dmJobs).set({ scheduledAt: start, nextAttemptAt: start });
    }
    const started = performance.now();
    try {
      const end = continuous ? await drainContinuously(deps, fixture.jobIds.length) : await drain(deps, start, realtime); const wallMs = performance.now() - started;
      const sent = await db.select().from(dmJobs).where(eq(dmJobs.status, "sent"));
      const attempts = await db.select().from(sendAttempts).where(eq(sendAttempts.state, "accepted"));
      expect(new Set(sent.map((j) => j.id))).toEqual(new Set(fixture.jobIds));
      expect(received).toHaveLength(fixture.jobIds.length); expect(new Set(received).size).toBe(fixture.jobIds.length); expect(attempts).toHaveLength(fixture.jobIds.length);
      expect(await db.select().from(dmJobs).where(inArray(dmJobs.status, ["sending", "leased", "waiting", "retry", "unknown", "failed"]))).toHaveLength(0);
      const windows = fixture.accounts.map((a) => maxRollingHour(attempts.filter((attempt) => attempt.igAccountId === a.id && attempt.channel === "private_reply").map((attempt) => attempt.invokedAt!.getTime())));
      if (includePublic) for (const account of fixture.accounts) expect(maxRollingHour(attempts.filter((a) => a.igAccountId === account.id && a.channel === "public_reply").map((a) => a.invokedAt!.getTime()))).toBeLessThanOrEqual(120);
      expect(Math.max(...windows)).toBeLessThanOrEqual(400);
      const privateCalls = attempts.filter((a) => a.channel === "private_reply");
      const privateCompletionMs = Math.max(...privateCalls.map((a) => a.finishedAt!.getTime())) - start.getTime();
      const expectedPrivateMs = 12 / 400 * 3_600_000;
      const report = { scenario: "dispatch-only-250-accounts-3000-comments", measuredAt: new Date().toISOString(), accounts: 250, jobs: fixture.jobIds.length, simulatedClock: !realtime, continuous, includePublic, httpFixtureDelayMs: httpDelayMs, poolSize: 10, dispatchConcurrency: 64, peakHttpConnections: peakConnections, wallMs: Math.round(wallMs), drainMs: end.getTime() - start.getTime(), privateCompletionMs, expectedPrivateMs, privateEtaErrorMs: privateCompletionMs - expectedPrivateMs, accepted: received.length, duplicates: 0, missing: 0, unknown: 0, maximumObservedRollingHour: Math.max(...windows), configuredHourlyRate: 400, externalMetaCalls: 0 };
      if (process.env.GONGGU_DISPATCH_LOAD_REPORT) await writeFile(process.env.GONGGU_DISPATCH_LOAD_REPORT, `${JSON.stringify(report, null, 2)}\n`);
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  }, 600_000);

  it("never exceeds 400 actual call starts in any rolling hour across 401 sends", async () => {
    const db = getDb(); await seedDispatchLoad(1, 401, CAMPAIGN_NOW);
    const graph = new FakeGraphClient();
    await drain({ db, graph, decryptToken: decryptSecret, random: () => 0, render: async () => ({ kind: "text", text: "fixture" }) }, CAMPAIGN_NOW);
    const calls = await db.select().from(sendAttempts).where(and(eq(sendAttempts.state, "accepted"), eq(sendAttempts.channel, "private_reply")));
    expect(calls).toHaveLength(401); expect(graph.dms).toHaveLength(401);
    expect(maxRollingHour(calls.map((a) => a.invokedAt!.getTime()))).toBeLessThanOrEqual(400);
  }, 120_000);
});
