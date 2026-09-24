import { describe, expect, it } from "vitest";
import { matchesKeywords, normalizeText, rulesToBind, selectAutomation, type RuleLike } from "@/server/automations/matcher";

describe("normalizeText", () => {
  it("applies NFKC, lowercases and collapses whitespace", () => {
    expect(normalizeText("  ＬＩＮＫ\n\n주세요  ")).toBe("link 주세요");
  });
});

describe("matchesKeywords", () => {
  it("contains: matches keyword inside longer comment", () => {
    expect(matchesKeywords("공구요!! 저도요", ["공구"], "contains")).toBe(true);
    expect(matchesKeywords("@친구 공구", ["공구"], "contains")).toBe(true);
  });
  it("contains: is case and width insensitive", () => {
    expect(matchesKeywords("ＬＩＮＫ please", ["link"], "contains")).toBe(true);
    expect(matchesKeywords("Link", ["LINK"], "contains")).toBe(true);
  });
  it("exact: ignores trailing punctuation and emoji", () => {
    expect(matchesKeywords("공구🙏", ["공구"], "exact")).toBe(true);
    expect(matchesKeywords("공구!!", ["공구"], "exact")).toBe(true);
    expect(matchesKeywords(" 공구 ", ["공구"], "exact")).toBe(true);
    expect(matchesKeywords("❤️공구❤️", ["공구"], "exact")).toBe(true);
  });
  it("exact: rejects extra words", () => {
    expect(matchesKeywords("공구 주세요", ["공구"], "exact")).toBe(false);
    expect(matchesKeywords("@친구 공구", ["공구"], "exact")).toBe(false);
  });
  it("any of several keywords matches", () => {
    expect(matchesKeywords("링크", ["공구", "링크"], "exact")).toBe(true);
  });
  it("empty or blank keywords never match", () => {
    expect(matchesKeywords("아무거나", [], "contains")).toBe(false);
    expect(matchesKeywords("아무거나", ["  "], "contains")).toBe(false);
  });
  it("any: matches every comment regardless of keywords", () => {
    expect(matchesKeywords("예뻐요", [], "any")).toBe(true);
    expect(matchesKeywords("", [], "any")).toBe(true);
    expect(matchesKeywords("아무 말", ["공구"], "any")).toBe(true);
  });
});

const rule = (o: Partial<RuleLike> & { id: string }): RuleLike => ({
  mediaScope: "all",
  mediaId: null,
  keywords: ["공구"],
  matchType: "contains",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  ...o,
});

describe("selectAutomation", () => {
  it("prefers a specific-media rule over an all-media rule", () => {
    const rules = [
      rule({ id: "all", createdAt: new Date("2026-09-10T00:00:00Z") }),
      rule({ id: "specific", mediaScope: "specific", mediaId: "m1" }),
    ];
    expect(selectAutomation(rules, "m1", "공구")?.id).toBe("specific");
  });
  it("ignores specific rules for other media", () => {
    const rules = [rule({ id: "specific", mediaScope: "specific", mediaId: "m2" })];
    expect(selectAutomation(rules, "m1", "공구")).toBeNull();
  });
  it("picks the newest rule within the same scope", () => {
    const rules = [
      rule({ id: "old", createdAt: new Date("2026-09-01T00:00:00Z") }),
      rule({ id: "new", createdAt: new Date("2026-09-05T00:00:00Z") }),
    ];
    expect(selectAutomation(rules, "m1", "공구")?.id).toBe("new");
  });
  it("falls through to a rule whose keywords match", () => {
    const rules = [
      rule({ id: "specific", mediaScope: "specific", mediaId: "m1", keywords: ["링크"] }),
      rule({ id: "all", keywords: ["공구"] }),
    ];
    expect(selectAutomation(rules, "m1", "공구")?.id).toBe("all");
  });
  it("never selects an unbound next rule", () => {
    expect(selectAutomation([rule({ id: "next", mediaScope: "next" })], "m1", "공구")).toBeNull();
  });
  it("prefers keyword rules over newer 'any' rules within the same scope", () => {
    const rules = [
      rule({ id: "any", matchType: "any", keywords: [], createdAt: new Date("2026-09-20T00:00:00Z") }),
      rule({ id: "kw", keywords: ["공구"], createdAt: new Date("2026-09-01T00:00:00Z") }),
    ];
    expect(selectAutomation(rules, "m1", "공구요")?.id).toBe("kw");
    expect(selectAutomation(rules, "m1", "예뻐요")?.id).toBe("any");
  });
  it("prefers a specific-media 'any' rule over an all-media keyword rule", () => {
    const rules = [
      rule({ id: "all-kw", keywords: ["공구"] }),
      rule({ id: "specific-any", mediaScope: "specific", mediaId: "m1", matchType: "any", keywords: [] }),
    ];
    expect(selectAutomation(rules, "m1", "공구")?.id).toBe("specific-any");
  });
});

describe("rulesToBind", () => {
  it("binds unbound next rules created before the media was published", () => {
    const rules = [
      rule({ id: "before", mediaScope: "next", createdAt: new Date("2026-09-01T00:00:00Z") }),
      rule({ id: "after", mediaScope: "next", createdAt: new Date("2026-09-20T00:00:00Z") }),
      rule({ id: "bound", mediaScope: "next", mediaId: "x" }),
    ];
    expect(rulesToBind(rules, new Date("2026-09-10T00:00:00Z"))).toEqual(["before"]);
  });
  it("binds nothing without a publish time", () => {
    expect(rulesToBind([rule({ id: "n", mediaScope: "next" })], null)).toEqual([]);
  });
});
