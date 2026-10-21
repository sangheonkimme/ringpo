import type { MessageEvent } from "@/server/db/schema";
import { routeLegacyFollowMessage, type FollowInboxDeps } from "@/server/pipeline/follow-inbox";
import { routeCampaignFollowMessage } from "./follow-messages";
import { finishMessageEvent } from "./message-inbox";

/** One durable envelope has one owner. Ordinary inbound DMs are never a cold-send audience. */
export async function routeMessageEvent(deps: FollowInboxDeps, message: MessageEvent): Promise<string> {
  if (!message.legacyEventId) {
    const campaign = await routeCampaignFollowMessage(deps, message);
    if (campaign !== null) return campaign;
  }
  if (!message.campaignId) {
    const legacy = await routeLegacyFollowMessage(deps, message);
    if (legacy !== null) return legacy;
  }
  await finishMessageEvent(deps.db, message, deps.now(), "ignored", "no_matching_message_rule");
  return "ignored";
}
