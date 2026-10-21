import { describe, expect, it } from "vitest";
import { matchesCampaignKeywords, matchesKeywords, normalizeCampaignText, selectAutomation } from "@/server/automations/matcher";
import { matchCampaignComment } from "@/server/campaigns/matcher";
import { compareCampaignJobs, privateReplyDeadline } from "@/lib/campaign-jobs";

describe("campaign Korean keyword policy", () => {
  it.each([
    ["링크요", "링크", "contains", true], ["링크!!", "링크", "contains", true],
    ["링크 주세요", "링크", "contains", true], ["  🔥링크!!💕 ", "링크", "exact", true],
    ["링크 주세요", "링크", "exact", false], ["LiNk!", "link", "exact", true],
    ["링크", "링크", "exact", true], ["링크", "링크", "exact", true],
    ["👨‍👩‍👧‍👦 링크 🇰🇷", "링크", "exact", true], ["1️⃣!링크!2️⃣", "링크", "exact", true],
    ["링1️⃣크", "링크", "exact", false], ["ＬＩＮＫ", "link", "contains", false],
    ["🔥", "🔥", "contains", false], ["!!!", "!", "exact", false],
    ["", "링크", "contains", false], ["링크", "", "contains", false],
  ] as const)("%s / %s (%s) = %s", (text, keyword, mode, expected) => {
    expect(matchesCampaignKeywords(text, [keyword], mode)).toBe(expected);
  });
  it("leaves the existing NFKC and emoji-only matching policy intact", () => {
    expect(matchesKeywords("ＬＩＮＫ", ["link"], "contains")).toBe(true);
    expect(matchesKeywords("🔥", ["🔥"], "exact")).toBe(true);
    expect(normalizeCampaignText("링크  주세요")).toBe("링크 주세요");
  });
  it("prioritizes campaign actions, suppresses exclusions, and falls back to specific before account-wide rules", () => {
    const rule = { notificationKeywords: ["알림"], linkKeywords: ["링크"], excludedKeywords: ["광고"], matchType: "contains" as const };
    expect(matchCampaignComment(rule, "teaser", "링크 알림")).toBe("notification");
    expect(matchCampaignComment(rule, "open", "링크 알림")).toBe("link");
    expect(matchCampaignComment(rule, "open", "광고 링크")).toBe("excluded");
    expect(matchCampaignComment(rule, "closed", "알림")).toBe("no_match");
    expect(matchCampaignComment(rule, "sold_out", "링크")).toBe("closed_notice");
    expect(matchCampaignComment(rule, "draft", "링크")).toBe("no_match");
    const common = { mediaId: "media", keywords: ["배송"], matchType: "contains" as const, createdAt: new Date() };
    expect(matchCampaignComment(rule, "open", "배송")).toBe("no_match");
    expect(selectAutomation([{ ...common, id: "all", mediaScope: "all" }, { ...common, id: "specific", mediaScope: "specific" }], "media", "배송")?.id).toBe("specific");
  });
});

describe("campaign deadlines and EDF order", () => {
  it("uses Meta comment creation time, with the safety hour before the seven-day boundary", () => {
    expect(privateReplyDeadline(new Date("2026-10-20T15:00:00Z"), 604800, 3600)).toEqual({ deadlineAt: new Date("2026-10-27T14:00:00Z"), hardExpiresAt: new Date("2026-10-27T15:00:00Z") });
    expect(() => privateReplyDeadline(new Date(), 3600, 3600)).toThrow();
  });
  it("sorts earliest deadlines, then comment creation times, then deterministic job IDs", () => {
    const row = (id: string, deadline: number, comment: number) => ({ id, deadlineAt: new Date(deadline), commentCreatedAt: new Date(comment) });
    expect([row("c", 20, 5), row("b", 10, 2), row("a", 10, 2), row("d", 10, 1)].sort(compareCampaignJobs).map((j) => j.id)).toEqual(["d", "a", "b", "c"]);
  });
});
