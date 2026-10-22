import type { MessageEvent } from "@/server/db/schema";
import { routeLegacyFollowMessage, type FollowInboxDeps } from "@/server/pipeline/follow-inbox";
import { routeCampaignFollowMessage } from "./follow-messages";
import { finishMessageEvent } from "./message-inbox";
import { routeCampaignFaq } from "./faq-messages";
import { routeConversationEcho } from "./conversation-handoff";

/** One durable envelope has one owner. Ordinary inbound DMs are never a cold-send audience. */
export async function routeMessageEvent(deps: FollowInboxDeps, message: MessageEvent): Promise<string> {
  const echo = await routeConversationEcho(deps, message);
  if (echo !== null) return echo;
  if (!message.legacyEventId) {
    const campaign = await routeCampaignFollowMessage(deps, message);
    if (campaign !== null) return campaign;
    const faq = await routeCampaignFaq(deps, message);
    if (faq !== null) return faq;
  }
  if (!message.campaignId) {
    const legacy = await routeLegacyFollowMessage(deps, message);
    if (legacy !== null) return legacy;
  }
  await finishMessageEvent(deps.db, message, deps.now(), "ignored", "no_matching_message_rule");
  return "ignored";
}
