import { decryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { getGraphClient } from "@/server/instagram/client";
import { parseCommentWebhook, parseFollowTaps, verifyHubSignature } from "@/server/instagram/webhook";
import { log } from "@/server/log";
import { handleLegacyTapWithGuard } from "@/server/pipeline/follow-webhook";
import { parseCampaignMessages } from "@/server/instagram/campaign-messaging";
import { ingestGuardedMessages } from "@/server/campaigns/message-inbox";
import type { PipelineDeps } from "@/server/pipeline/process-comment";
import { ingestComments } from "@/server/queue/ingest";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === getEnv().IG_WEBHOOK_VERIFY_TOKEN) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const env = getEnv();
  const raw = await req.text();
  if (!verifyHubSignature(raw, req.headers.get("x-hub-signature-256"), [env.IG_APP_SECRET, env.META_APP_SECRET])) {
    // 앱 시크릿이 어긋나면 Meta 알림이 전부 여기서 막히므로 운영 로그에 남긴다
    log.warn("webhook signature rejected", { bytes: raw.length });
    return new Response("invalid signature", { status: 401 });
  }
  const comments = parseCommentWebhook(raw);
  const queued = comments.length > 0 ? await ingestComments(getDb(), comments, new Date()) : 0;
  const taps = parseFollowTaps(raw);
  const messages = parseCampaignMessages(raw);
  // Guarded accounts acknowledge only after durable insertion; Meta reads/writes happen in the worker.
  const inbox = await ingestGuardedMessages(getDb(), messages, new Date(), taps);
  const outcomes: string[] = [];
  if (taps.length > 0) {
    const deps: PipelineDeps = {
      db: getDb(),
      graph: getGraphClient(),
      now: () => new Date(),
      random: Math.random,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      appUrl: env.APP_URL,
      hourlyLimit: env.IG_PRIVATE_REPLY_HOURLY_LIMIT,
      decryptToken: decryptSecret,
    };
    for (const tap of taps) outcomes.push(inbox.guardedIgUserIds.has(tap.igUserId) ? "guarded" : await handleLegacyTapWithGuard(deps, tap, messages));
  }
  log.info("webhook received", { comments: comments.length, queued, messagesQueued: inbox.queued, followTaps: outcomes });
  return new Response("ok", { status: 200 });
}
