import { hostname } from "node:os";
import { createBillingDeps } from "@/server/billing/deps";
import { billingConfigured } from "@/server/billing/gateway";
import { processDueRenewals } from "@/server/billing/subscriptions";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { createDb } from "@/server/db/client";
import { emails } from "@/server/emails";
import { getEnv } from "@/server/env";
import { createGraphClient } from "@/server/instagram/graph";
import { errorFields, log } from "@/server/log";
import { notifyUser } from "@/server/notifications";
import { processCommentEvent, type PipelineDeps } from "@/server/pipeline/process-comment";
import { claimEvents, QUEUE_CHANNEL } from "@/server/queue/events";
import { beat, cleanupOldData, expireStaleEvents, refreshExpiringTokens, withJobLock } from "./jobs";
import { startEventLoop } from "./loop";
import { startScheduler, type ScheduledJob } from "./scheduler";

const MINUTE = 60_000;

async function main() {
  const env = getEnv();
  const { db, sql } = createDb(env.DATABASE_URL, { max: env.WORKER_CONCURRENCY + 4 });
  const graph = createGraphClient({ version: env.IG_GRAPH_API_VERSION });
  const workerId = `${hostname()}-${process.pid}`;

  const deps: PipelineDeps = {
    db,
    graph,
    now: () => new Date(),
    random: Math.random,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    appUrl: env.APP_URL,
    hourlyLimit: env.IG_PRIVATE_REPLY_HOURLY_LIMIT,
    decryptToken: decryptSecret,
    onAuthFailure: (a) => notifyUser(db, a.userId, emails.reauthRequired(a.username)),
  };

  const loop = startEventLoop({
    concurrency: env.WORKER_CONCURRENCY,
    pollMs: 2000,
    claim: (n) => claimEvents(db, { batch: n, now: new Date() }),
    handle: async (event) => {
      const outcome = await processCommentEvent(deps, event);
      log.info("event processed", { eventId: event.id, outcome, attempts: event.attempts });
    },
    onError: (e) => log.error("event loop error", errorFields(e)),
  });

  await sql.listen(QUEUE_CHANNEL, () => loop.wake());

  const jobs: ScheduledJob[] = [
    {
      name: "refresh-tokens",
      intervalMs: 60 * MINUTE,
      run: async () => {
        const res = await refreshExpiringTokens({
          db,
          graph,
          now: () => new Date(),
          encrypt: encryptSecret,
          decrypt: decryptSecret,
          onReauthRequired: (a) => notifyUser(db, a.userId, emails.reauthRequired(a.username)),
        });
        log.info("token refresh", res);
      },
    },
    { name: "expire-events", intervalMs: 10 * MINUTE, run: async () => void (await expireStaleEvents(db, new Date())) },
    { name: "cleanup", intervalMs: 60 * MINUTE, run: () => cleanupOldData(db, new Date()) },
  ];
  if (billingConfigured()) {
    jobs.push({
      name: "billing-renewals",
      intervalMs: 10 * MINUTE,
      run: async () => {
        const count = await processDueRenewals(createBillingDeps(db));
        if (count > 0) log.info("billing renewals processed", { count });
      },
    });
  }
  const scheduler = startScheduler(jobs, {
    withLock: (name, fn) => withJobLock(db, name, fn),
    onError: (name, e) => log.error("scheduled job failed", { job: name, ...errorFields(e) }),
  });

  await beat(db, workerId, new Date());
  const heartbeat = setInterval(() => {
    beat(db, workerId, new Date()).catch((e) => log.error("heartbeat failed", errorFields(e)));
  }, 10_000);

  log.info("worker started", { workerId, concurrency: env.WORKER_CONCURRENCY });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("worker stopping", { signal });
    scheduler.stop();
    clearInterval(heartbeat);
    await loop.stop();
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  log.error("worker crashed", errorFields(e));
  process.exit(1);
});
