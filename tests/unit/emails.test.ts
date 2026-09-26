import { describe, expect, it } from "vitest";
import { emails } from "@/server/emails";

describe("email templates", () => {
  it("escapes html and includes the link", () => {
    const m = emails.magicLink("https://app.test/api/auth/magic-link/verify?token=a&b=<x>");
    expect(m.subject).toContain("로그인");
    expect(m.html).toContain("&lt;x&gt;");
    expect(m.text).toContain("https://app.test/api/auth/magic-link/verify?token=a&b=<x>");
  });
  it("renders reauth and billing notices", () => {
    expect(emails.reauthRequired("creator").text).toContain("@creator");
    expect(emails.paymentFailed("Pro", new Date("2026-10-02T00:00:00Z")).text).toContain("Pro");
    expect(emails.downgraded("payment_failed").subject).toContain("Free");
  });
});
