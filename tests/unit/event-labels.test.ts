import { describe, expect, it } from "vitest";
import { keywordSummary, SKIP_LABEL } from "@/lib/event-labels";

describe("keywordSummary", () => {
  it("lists keywords with the match mode", () => {
    expect(keywordSummary(["공구", "링크"], "contains")).toBe("공구, 링크");
    expect(keywordSummary(["링크"], "exact")).toBe("링크 (정확히 일치)");
  });
  it("describes all-comment automations", () => {
    expect(keywordSummary([], "any")).toBe("모든 댓글");
  });
});

describe("SKIP_LABEL", () => {
  it("says a duplicate skip is scoped to the post", () => {
    expect(SKIP_LABEL.duplicate).toBe("이 게시물에서 이미 보낸 사람");
  });
});
