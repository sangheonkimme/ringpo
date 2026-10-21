import { dispatchCampaignJob } from "@/server/campaigns/dispatch";
import { claimCampaignJobs } from "@/server/campaigns/jobs";
import { claimMessageEvents } from "@/server/campaigns/message-inbox";
import { routeMessageEvent } from "@/server/campaigns/message-router";
import { renderCampaignMessage } from "@/server/campaigns/render";
import { claimCampaignEvents, routeCampaignEvent } from "@/server/campaigns/routing";
import { log } from "@/server/log";
import { and, eq } from "drizzle-orm";
import { commentEvents, dmJobs, messageEvents } from "@/server/db/schema";
import type { FollowInboxDeps } from "@/server/pipeline/follow-inbox";
import { startEventLoop } from "./loop";

/** HTTP concurrency is independent of the PG connection pool; no transaction spans an HTTP request. */
export function startCampaignLoops(deps: FollowInboxDeps & { hashKey: string; workerId: string }, concurrency: { router: number; sender: number; inbox: number }) {
  const error = (component: string) => (e: unknown) => log.error(`${component} error`, { error: e instanceof Error ? e.name : "Error" });
  const router = startEventLoop({
    concurrency: concurrency.router, pollMs: 2000,
    claim: (batch) => claimCampaignEvents(deps.db, { batch, now: deps.now() }),
    handle: async (event) => {
      const outcome = await routeCampaignEvent(deps, event);
      log.info("campaign comment routed", { campaign_id: event.campaignId, ig_comment_id: event.commentId, outcome });
    }, onError: error("campaign router"),
  });
  const sender = startEventLoop({
    concurrency: concurrency.sender, pollMs: 250,
    claim: (batch) => claimCampaignJobs(deps.db, { batch, now: deps.now(), workerId: deps.workerId }),
    handle: async (job) => {
      const outcome = await dispatchCampaignJob({ ...deps, render: (db, context) => renderCampaignMessage(db, context, deps.appUrl) }, job);
      const [source] = job.sourceEventId ? await deps.db.select({ id: commentEvents.commentId }).from(commentEvents).where(eq(commentEvents.id, job.sourceEventId)) : [];
      log.info("campaign job processed", { account_id: job.igAccountId, campaign_id: job.campaignId, job_id: job.id, ig_comment_id: source?.id ?? null, channel: job.channel, outcome });
    }, onError: error("campaign sender"),
  });
  const inbox = startEventLoop({
    concurrency: concurrency.inbox, pollMs: 500,
    claim: (batch) => claimMessageEvents(deps.db, { batch, now: deps.now() }),
    handle: async (message) => {
      const outcome = await routeMessageEvent(deps, message);
      const [source] = await deps.db.select({ campaignId: messageEvents.campaignId, jobId: dmJobs.id, commentId: commentEvents.commentId }).from(messageEvents)
        .leftJoin(dmJobs, eq(dmJobs.sourceMessageEventId, messageEvents.id)).leftJoin(commentEvents, eq(commentEvents.id, messageEvents.legacyEventId))
        .where(and(eq(messageEvents.id, message.id), eq(messageEvents.igAccountId, message.igAccountId))).limit(1);
      log.info("message event processed", { account_id: message.igAccountId, campaign_id: source?.campaignId ?? null, job_id: source?.jobId ?? null, ig_comment_id: source?.commentId ?? null, message_event_id: message.id, outcome });
    }, onError: error("message inbox"),
  });
  return { wakeComments: router.wake, wakeJobs: sender.wake, wakeMessages: inbox.wake, stop: () => Promise.all([router.stop(), sender.stop(), inbox.stop()]) };
}
