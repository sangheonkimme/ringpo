import { Webhook } from "@portone/server-sdk";
import { createBillingDeps } from "@/server/billing/deps";
import { syncPayment } from "@/server/billing/subscriptions";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { log } from "@/server/log";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = getEnv().PORTONE_WEBHOOK_SECRET;
  if (!secret) return new Response("not configured", { status: 503 });
  const body = await req.text();
  let hook: Awaited<ReturnType<typeof Webhook.verify>>;
  try {
    hook = await Webhook.verify(secret, body, Object.fromEntries(req.headers));
  } catch (e) {
    if (e instanceof Webhook.WebhookVerificationError) return new Response("invalid signature", { status: 400 });
    throw e;
  }
  if (!Webhook.isUnrecognizedWebhook(hook) && hook.type.startsWith("Transaction.")) {
    const paymentId = (hook.data as { paymentId?: string }).paymentId;
    if (paymentId) {
      await syncPayment(createBillingDeps(getDb()), paymentId);
      log.info("portone webhook synced", { type: hook.type });
    }
  }
  return new Response("ok", { status: 200 });
}
