import { z } from "zod";
import { matchesCampaignKeywords, normalizeCampaignText } from "@/server/automations/matcher";

export const FAQ_PREFIX = "공구 자동 안내\n\n";
const keyword = z.string().trim().min(1).max(100).refine((s) => normalizeCampaignText(s).length > 0);
export const faqInputSchema = z.object({
  campaignId: z.uuid(), id: z.uuid().optional(), expectedVersion: z.number().int().positive().optional(), requestId: z.uuid(),
  keywords: z.array(keyword).min(1).max(20), excludedKeywords: z.array(keyword).max(20),
  matchType: z.enum(["contains", "exact"]), answer: z.string().trim().min(1).refine((s) => new TextEncoder().encode(FAQ_PREFIX + s).length <= 1000, "답변은 자동 안내 표시를 포함해 1,000바이트 이내여야 해요"),
  enabled: z.boolean(), priority: z.number().int().min(0).max(100),
});
export type FaqInput = z.infer<typeof faqInputSchema>;
export interface FaqRule { id: string; enabled: boolean; priority: number; keywords: string[]; excludedKeywords: string[]; matchType: "contains" | "exact" }
/** Stable priority, then ID. One incoming question receives at most one answer. */
export function matchCampaignFaq(text: string, rules: FaqRule[]) {
  return [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)).find((rule) => rule.enabled &&
    !matchesCampaignKeywords(text, rule.excludedKeywords, "contains") && matchesCampaignKeywords(text, rule.keywords, rule.matchType)) ?? null;
}
