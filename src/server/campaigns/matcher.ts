import type { CampaignState } from "@/lib/campaign-schema";
import { matchesCampaignKeywords } from "@/server/automations/matcher";

export interface CampaignRuleSnapshot {
  notificationKeywords: string[];
  linkKeywords: string[];
  excludedKeywords: string[];
  matchType: "contains" | "exact";
}

export type CampaignMatch = "notification" | "link" | "closed_notice" | "excluded" | "no_match";

/** One campaign action consumes the comment; only no_match permits legacy fallback. */
export function matchCampaignComment(rules: CampaignRuleSnapshot, state: CampaignState, text: string): CampaignMatch {
  if (matchesCampaignKeywords(text, rules.excludedKeywords, "contains")) return "excluded";
  const link = matchesCampaignKeywords(text, rules.linkKeywords, rules.matchType);
  const notification = matchesCampaignKeywords(text, rules.notificationKeywords, rules.matchType);
  if (state === "teaser") return notification ? "notification" : "no_match";
  if (state === "open") return link || notification ? "link" : "no_match";
  if (["closed", "sold_out", "settled"].includes(state)) return link ? "closed_notice" : "no_match";
  return "no_match";
}
