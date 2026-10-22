import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { faqInputSchema, matchCampaignFaq } from "@/lib/campaign-faq";
const rules = [
  { id: "a", priority: 1, enabled: true, keywords: ["배송"], excludedKeywords: ["배송 취소"], matchType: "contains" as const },
  { id: "b", priority: 0, enabled: true, keywords: ["교환"], excludedKeywords: [], matchType: "exact" as const },
];
describe("FAQ matching", () => {
  it.each([[" 배송 언제 와요?? 🚚 ", "a"], ["배송 취소", null], ["배송 교환", "a"], ["교환!!", "b"], ["교환해주세요", null], ["ㄱ", null]])("matches %s once", (text, id) => expect(matchCampaignFaq(text!, rules)?.id ?? null).toBe(id));
  it("uses stable priority and excludes disabled rules", () => {
    const other = { ...rules[0], id: "z", priority: 0 };
    expect(matchCampaignFaq("배송", [rules[0], other])?.id).toBe("z");
    expect(matchCampaignFaq("배송", [{ ...rules[0], enabled: false }])).toBeNull();
  });
  it("limits UTF-8 bytes including the automated-response label", () => {
    const input = { campaignId: randomUUID(), requestId: randomUUID(), keywords: ["배송"], excludedKeywords: [], matchType: "contains", answer: "가".repeat(320), enabled: true, priority: 0 };
    expect(faqInputSchema.safeParse(input).success).toBe(true);
    expect(faqInputSchema.safeParse({ ...input, answer: "가".repeat(333) }).success).toBe(false);
  });
});
