import { describe, expect, it } from "vitest";
import { automationInputSchema } from "@/lib/automation-schema";

const valid = {
  igAccountId: "5f0c7c1e-1d2b-4c3a-9e8f-0a1b2c3d4e5f",
  name: "공구 자동화",
  mediaScope: "all" as const,
  media: null,
  keywords: ["공구"],
  matchType: "contains" as const,
  replyEnabled: true,
  replyTexts: ["{username} DM 확인해주세요!"],
  dmText: "구매 링크 보내드려요",
  dmButtonTitle: "구매하기",
  dmLinkUrl: "https://shop.example.com/p/1",
};

const issues = (input: unknown) => {
  const r = automationInputSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("automationInputSchema", () => {
  it("accepts a valid automation", () => {
    expect(automationInputSchema.safeParse(valid).success).toBe(true);
  });
  it("requires https links", () => {
    expect(issues({ ...valid, dmLinkUrl: "http://shop.example.com" })).toContain("https:// 로 시작하는 링크를 입력해주세요");
  });
  it("forbids links and too many hashtags in public replies", () => {
    expect(issues({ ...valid, replyTexts: ["여기 www.x.com"] })).toContain("공개 답글에는 링크를 넣을 수 없어요");
    expect(issues({ ...valid, replyTexts: ["#a #b #c #d #e"] })).toContain("해시태그는 4개까지 넣을 수 있어요");
  });
  it("requires a media selection for specific scope", () => {
    expect(issues({ ...valid, mediaScope: "specific" })).toContain("게시물을 선택해주세요");
  });
  it("requires reply texts when replies are enabled", () => {
    expect(issues({ ...valid, replyTexts: [] })).toContain("답글 문구를 1개 이상 입력해주세요");
    expect(automationInputSchema.safeParse({ ...valid, replyEnabled: false, replyTexts: [] }).success).toBe(true);
  });
  it("allows no keywords only for the 'any' match type", () => {
    const parsed = automationInputSchema.safeParse({ ...valid, matchType: "any", keywords: [] });
    expect(parsed.success).toBe(true);
  });
  it("requires at least one keyword and caps lengths", () => {
    expect(issues({ ...valid, keywords: [] })).toContain("키워드를 1개 이상 입력해주세요");
    expect(automationInputSchema.safeParse({ ...valid, dmButtonTitle: "가".repeat(21) }).success).toBe(false);
    expect(automationInputSchema.safeParse({ ...valid, dmText: "가".repeat(601) }).success).toBe(false);
  });
});
