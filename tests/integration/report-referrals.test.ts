import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as joinReport } from "@/app/join/[code]/route";
import { attributeReportSignup, REPORT_REFERRAL_COOKIE, signReportReferral } from "@/server/campaigns/report-referrals";
import { createReportShare, reportReferralSummary, revokeReportShare } from "@/server/campaigns/report-shares";
import { getAuth } from "@/server/auth";
import { campaigns, reportReferralSignups, reportShares, user } from "@/server/db/schema";
import { seedCampaignConfig } from "../helpers/campaigns";
import { resetDb } from "../helpers/db";
import { createUser } from "../helpers/factories";
import { reportSharingWorld } from "../helpers/report-sharing";

const emailFixture = vi.hoisted(() => ({ texts: [] as string[] }));
vi.mock("@/server/email", () => ({ sendEmail: vi.fn(async (message: { text: string }) => { emailFixture.texts.push(message.text); }) }));
const secret = () => process.env.BETTER_AUTH_SECRET!;
const cookie = (code: string, now: Date) => `${REPORT_REFERRAL_COOKIE}=${signReportReferral(code, now, secret())}`;
async function source() {
  const w = await reportSharingWorld(); const issued = await createReportShare(w.db, w.user.id, w.shareInput); const [share] = await w.db.select().from(reportShares).where(eq(reportShares.id, issued.id));
  return { ...w, share };
}
describe("report signup attribution", () => {
  beforeEach(async () => { await resetDb(); await seedCampaignConfig(); emailFixture.texts.length = 0; });

  it("sets a signed first-touch cookie on a human GET without passing report access tokens to login", async () => {
    const w = await source();
    const response = await joinReport(new Request(`http://localhost:3000/join/${w.share.referralCode}`, { headers: { "user-agent": "Mozilla/5.0" } }), { params: Promise.resolve({ code: w.share.referralCode }) });
    expect(response.status).toBe(302); expect(response.headers.get("location")).toBe("http://localhost:3000/login?utm_source=ringpo&utm_medium=report&utm_campaign=brand_report");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly"); expect(response.headers.get("set-cookie")).toContain("SameSite=lax"); expect(response.headers.get("cache-control")).toContain("no-store");
    const existing = cookie(w.share.referralCode, new Date());
    const second = await joinReport(new Request("http://localhost:3000/join/other", { headers: { "user-agent": "Mozilla/5.0", cookie: existing } }), { params: Promise.resolve({ code: w.snapshot.referralCode }) });
    expect(second.headers.get("set-cookie")).toBeNull();
    for (const request of [new Request("http://localhost/join", { method: "HEAD" }), new Request("http://localhost/join", { headers: { "user-agent": "facebookexternalhit/1.1" } }), new Request("http://localhost/join", { headers: { "user-agent": "Mozilla/5.0", purpose: "prefetch" } })]) expect((await joinReport(request, { params: Promise.resolve({ code: w.share.referralCode }) })).headers.get("set-cookie")).toBeNull();
  });

  it("counts a new signup once, never counts an existing account and distinguishes direct PDF signups", async () => {
    const w = await source(); const touch = new Date(); const signup = await createUser();
    const header = cookie(w.share.referralCode, touch);
    const results = await Promise.all([attributeReportSignup(w.db, signup.id, header, secret(), new Date()), attributeReportSignup(w.db, signup.id, header, secret(), new Date())]); expect(results.filter(Boolean)).toHaveLength(1);
    await w.db.update(user).set({ createdAt: new Date(+touch - 86_400_000) }).where(eq(user.id, w.user.id));
    expect(await attributeReportSignup(w.db, w.user.id, header, secret(), new Date())).toBe(false);
    const otherTouch = new Date(); const other = await createUser();
    expect(await attributeReportSignup(w.db, other.id, cookie(w.snapshot.referralCode, otherTouch), secret(), new Date())).toBe(true);
    expect(await reportReferralSummary(w.db, w.user.id, w.campaign.id)).toEqual({ total: 2, directPdf: 1 });
  });

  it("retains valid earlier-visit attribution after share revocation and rejects expired or tampered visits", async () => {
    const w = await source(); const touch = new Date(); const header = cookie(w.share.referralCode, touch); const signup = await createUser();
    await revokeReportShare(w.db, w.user.id, w.share.id); expect(await attributeReportSignup(w.db, signup.id, header, secret(), new Date())).toBe(true);
    const request = new Request("http://localhost/join", { headers: { "user-agent": "Mozilla/5.0" } });
    expect((await joinReport(request, { params: Promise.resolve({ code: w.share.referralCode }) })).headers.get("set-cookie")).toBeNull();
    const other = await createUser(); expect(await attributeReportSignup(w.db, other.id, header + "wrong", secret(), new Date())).toBe(false);
    expect(await attributeReportSignup(w.db, other.id, header, secret(), new Date(+touch + 31 * 86_400_000))).toBe(false);
    await w.db.delete(campaigns).where(eq(campaigns.id, w.campaign.id)); expect(await w.db.select().from(reportReferralSignups)).toHaveLength(0);
  });

  it("runs the real Better Auth magic-link signup/session hooks and does not count repeat login", async () => {
    const w = await source(); const header = cookie(w.share.referralCode, new Date(Date.now() - 1000)); const auth = getAuth(); const email = `report-${randomUUID()}@example.com`;
    const login = async () => {
      await auth.api.signInMagicLink({ body: { email, name: "Report fixture", callbackURL: "/app" }, headers: new Headers({ origin: "http://localhost:3000", cookie: header }) });
      const url = emailFixture.texts.pop()!.match(/https?:\/\/\S+/)![0];
      const response = await auth.handler(new Request(url, { headers: { cookie: header, "user-agent": "Mozilla/5.0" } }));
      expect(response.status).toBe(302);
    };
    await login(); expect(await w.db.select().from(reportReferralSignups)).toHaveLength(1);
    await login(); expect(await w.db.select().from(reportReferralSignups)).toHaveLength(1);
    expect(await reportReferralSummary(w.db, w.user.id, w.campaign.id)).toEqual({ total: 1, directPdf: 0 });
  });
});
