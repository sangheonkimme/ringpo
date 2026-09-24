import { describe, expect, it } from "vitest";
import { keywordSummary } from "@/lib/event-labels";

describe("keywordSummary", () => {
  it("lists keywords with the match mode", () => {
    expect(keywordSummary(["공구", "링크"], "contains")).toBe("공구, 링크");
    expect(keywordSummary(["링크"], "exact")).toBe("링크 (정확히 일치)");
  });
  it("describes all-comment automations", () => {
    expect(keywordSummary([], "any")).toBe("모든 댓글");
  });
});
