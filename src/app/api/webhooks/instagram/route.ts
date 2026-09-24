import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { parseCommentWebhook, verifyHubSignature } from "@/server/instagram/webhook";
import { log } from "@/server/log";
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
    return new Response("invalid signature", { status: 401 });
  }
  const comments = parseCommentWebhook(raw);
  if (comments.length > 0) {
    const queued = await ingestComments(getDb(), comments, new Date());
    log.info("webhook received", { comments: comments.length, queued });
  }
  return new Response("ok", { status: 200 });
}
