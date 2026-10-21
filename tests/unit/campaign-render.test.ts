import { describe, expect, it } from "vitest";
import { campaignLinkMessage, renderCampaignTemplate } from "@/server/campaigns/render";
import { campaignTargetUrl, countCampaignClick } from "@/server/campaigns/links";

const values = { productName: "크림", openAt: new Date("2026-10-21T00:00:00Z"), mediaUrl: "https://instagram.com/p/test", link: "https://ringpo.test/r/0123456789012345678901" };
describe("campaign rendering constraints", () => {
  it("keeps tracked URLs complete within the UTF-8 text limit, including repeated placeholders and emoji", () => {
    for (const body of ["가".repeat(600), "🧴".repeat(600), "{링크}".repeat(100), "{상품명} 구매 {링크}"]) {
      const message = campaignLinkMessage(body, values, "text");
      expect(Buffer.byteLength(message.text)).toBeLessThanOrEqual(1000); expect(message.text).toContain(values.link);
      expect(message.text).not.toContain("\uFFFD");
    }
  });
  it("renders Korean time and only interprets placeholders once", () => {
    const text = renderCampaignTemplate("{상품명} {오픈일시}", { ...values, productName: "{링크}" });
    expect(text).toContain("{링크}"); expect(text).toContain("오전 9:00"); expect(text).toContain("한국 시간");
    const message = campaignLinkMessage("가".repeat(600), values, "auto");
    expect(message.kind).toBe("button"); expect([...message.text].length).toBeLessThanOrEqual(640);
  });
  it.each(["http://shop.test", "javascript:alert(1)", "https://user:pass@shop.test"])("rejects an unsafe destination %s", (url) => {
    expect(() => campaignTargetUrl(url, "slug", { name: "상품", option: "" })).toThrow();
  });
  it.each(["purpose", "sec-purpose", "x-purpose"])("excludes %s prefetch requests", (header) => {
    expect(countCampaignClick(new Request(values.link, { headers: { "user-agent": "Mozilla/5.0", [header]: "prefetch" } }))).toBe(false);
  });
});
