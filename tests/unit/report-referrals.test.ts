import { describe, expect, it } from "vitest";
import { parseReportReferral, REPORT_REFERRAL_SECONDS, signReportReferral } from "@/server/campaigns/report-referrals";
const now = new Date("2026-10-21T00:00:00Z");
describe("signed report first-touch cookie", () => {
  it.each(["1234567890abcdef", "1234567890abcdef1234567890abcdef"])("accepts a valid share/PDF code %s for less than thirty days", (code) => {
    const cookie = signReportReferral(code, now, "secret"); expect(parseReportReferral(cookie, now, "secret")).toEqual({ code, touchedAt: now });
    expect(parseReportReferral(cookie, new Date(+now + REPORT_REFERRAL_SECONDS * 1000), "secret")).toBeNull();
  });
  it("rejects tampering, a wrong secret and a future visit timestamp", () => {
    const cookie = signReportReferral("1234567890abcdef", now, "secret");
    expect(parseReportReferral(cookie.replace("1234567890abcdef", "abcdefghijklmnop"), now, "secret")).toBeNull();
    expect(parseReportReferral(cookie, now, "wrong")).toBeNull(); expect(parseReportReferral(cookie, new Date(+now - 1), "secret")).toBeNull();
    expect(parseReportReferral(cookie + ".extra", now, "secret")).toBeNull(); expect(parseReportReferral("x".repeat(200), now, "secret")).toBeNull();
  });
});
