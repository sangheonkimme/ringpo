import { processCampaignReports } from "@/server/campaigns/report-operations";
import { hostname } from "node:os";
import { createBillingDeps } from "@/server/billing/deps";
import { advanceDueCampaigns } from "@/server/campaigns/service";
import { CAMPAIGN_QUEUE_CHANNEL } from "@/server/campaigns/routing";
import { expireMessageEvents, MESSAGE_QUEUE_CHANNEL, recoverMessageEvents } from "@/server/campaigns/message-inbox";
import { queueCampaignAlerts } from "@/server/campaigns/operations";
import { redactCampaignContent } from "@/server/campaigns/retention";
import { expireCampaignJobs, recoverCampaignJobs } from "@/server/campaigns/jobs";
import { sendCampaignNotifications } from "@/server/campaigns/notifications";
import { billingConfigured } from "@/server/billing/gateway";
import { processDueRenewals } from "@/server/billing/subscriptions";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { createDb } from "@/server/db/client";
import { emails } from "@/server/emails";
import { getEnv } from "@/server/env";
import { createGraphClient } from "@/server/instagram/graph";
import { errorFields, log } from "@/server/log";
import { notifyUser } from "@/server/notifications";
import type { PipelineDeps } from "@/server/pipeline/process-comment";
import { processWithSharedBudget } from "@/server/pipeline/shared-budget";
import { claimEvents, QUEUE_CHANNEL } from "@/server/queue/events";
import { beat, cleanupOldData, expireStaleEvents, refreshExpiringTokens, withJobLock } from "./jobs";
import { startEventLoop } from "./loop";
import { startCampaignLoops } from "./campaign-loops";
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
      const outcome = await processWithSharedBudget(deps, event);
      log.info("event processed", { eventId: event.id, outcome, attempts: event.attempts });
    },
    onError: (e) => log.error("event loop error", errorFields(e)),
  });

  const campaignLoops = startCampaignLoops({ ...deps, hashKey: env.ENCRYPTION_KEY, workerId }, {
    router: env.CAMPAIGN_ROUTER_CONCURRENCY, sender: env.CAMPAIGN_SENDER_CONCURRENCY, inbox: env.CAMPAIGN_INBOX_CONCURRENCY,
  });
  await sql.listen(QUEUE_CHANNEL, () => { loop.wake(); campaignLoops.wakeComments(); });
  await sql.listen(CAMPAIGN_QUEUE_CHANNEL, campaignLoops.wakeJobs);
  await sql.listen(MESSAGE_QUEUE_CHANNEL, campaignLoops.wakeMessages);

  const jobs: ScheduledJob[] = [
    { name: "campaign-reports", intervalMs: 30_000, run: async () => { await processCampaignReports(db, new Date()); } },
    { name: "campaign-transitions", intervalMs: 5_000, run: async () => { const count = await advanceDueCampaigns(db, new Date()); if (count) log.info("campaign transitions", { count }); } },
    { name: "campaign-job-maintenance", intervalMs: 5_000, run: async () => {
      const recovered = await recoverCampaignJobs(db, new Date());
      const expired = await expireCampaignJobs(db, new Date());
      const messagesRecovered = await recoverMessageEvents(db, new Date());
      const messagesExpired = await expireMessageEvents(db, new Date());
      if (recovered.waiting || recovered.unknown || expired) log.info("campaign queue maintenance", { ...recovered, expired });
      if (messagesRecovered || messagesExpired) log.info("message inbox maintenance", { recovered: messagesRecovered, expired: messagesExpired });
    } },
    { name: "campaign-operational-alerts", intervalMs: 30_000, run: async () => { await queueCampaignAlerts(db, new Date()); } },
    { name: "campaign-notifications", intervalMs: 30_000, run: async () => { await sendCampaignNotifications(db, new Date()); } },
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
    { name: "redact-campaign-content", intervalMs: MINUTE, run: async () => {
      const started = Date.now(); const counts = { comments: 0, messages: 0, payloads: 0 };
      for (let batch = 0; batch < 10 && Date.now() - started < 3000; batch++) {
        const removed = await redactCampaignContent(db, new Date());
        counts.comments += removed.comments; counts.messages += removed.messages; counts.payloads += removed.payloads;
        if (!removed.comments && !removed.messages && !removed.payloads) break;
      }
      if (counts.comments || counts.messages || counts.payloads) log.info("campaign content redacted", counts);
    } },
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
    // Outbox rows have their own leases; do not hold an advisory transaction during email HTTP requests.
    withLock: (name, fn) => name === "campaign-notifications" ? fn() : withJobLock(db, name, fn),
    onError: (name, e) => log.error("scheduled job failed", { job: name, ...errorFields(e) }),
  });

  await beat(db, workerId, new Date());
  const heartbeat = setInterval(() => {
    beat(db, workerId, new Date()).catch((e) => log.error("heartbeat failed", errorFields(e)));
  }, 10_000);

  log.info("worker started", { workerId, concurrency: env.WORKER_CONCURRENCY, campaignRouterConcurrency: env.CAMPAIGN_ROUTER_CONCURRENCY, campaignSenderConcurrency: env.CAMPAIGN_SENDER_CONCURRENCY, campaignInboxConcurrency: env.CAMPAIGN_INBOX_CONCURRENCY });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("worker stopping", { signal });
    scheduler.stop();
    clearInterval(heartbeat);
    await Promise.all([loop.stop(), campaignLoops.stop()]);
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
