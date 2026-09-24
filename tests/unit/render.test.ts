import { describe, expect, it } from "vitest";
import { brandingLine, buildTextFallback, renderReply, truncateChars, truncateUtf8 } from "@/server/automations/render";

describe("renderReply", () => {
  it("replaces {username} with an @mention", () => {
    expect(renderReply("{username} DM 확인해주세요!", "follower1")).toBe("@follower1 DM 확인해주세요!");
  });
  it("drops the placeholder when username is unknown", () => {
    expect(renderReply("{username} DM 확인해주세요!", null)).toBe("DM 확인해주세요!");
  });
});

describe("truncation", () => {
  it("truncateChars counts code points", () => {
    expect(truncateChars("가나다라", 3)).toBe("가나다");
    expect(truncateChars("🙂🙂🙂", 2)).toBe("🙂🙂");
  });
  it("truncateUtf8 keeps result within byte budget", () => {
    const out = truncateUtf8("가".repeat(500), 100);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(100);
    expect(out.endsWith("...")).toBe(true);
  });
  it("truncateUtf8 leaves short text alone", () => {
    expect(truncateUtf8("짧다", 100)).toBe("짧다");
  });
});

describe("buildTextFallback", () => {
  it("appends the link line and stays within 1000 bytes", () => {
    const out = buildTextFallback("가".repeat(600), "구매하기", "https://example.com/l/abc1234");
    expect(out.endsWith("\n\n구매하기: https://example.com/l/abc1234")).toBe(true);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(1000);
  });
});

describe("brandingLine", () => {
  it("mentions the service name", () => {
    expect(brandingLine()).toContain("리치업");
  });
});
