import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SharedReportPage from "@/app/reports/[token]/page";
import { GET as downloadPublic } from "@/app/reports/[token]/pdf/route";
import { GET as downloadOwner } from "@/app/api/campaigns/[id]/reports/[snapshotId]/pdf/route";
import { createReportShare, listReportShares, revokeReportShare, sharedReport } from "@/server/campaigns/report-shares";
import { campaigns, featureFlags, planEntitlements, reportShares } from "@/server/db/schema";
import { getSessionUser } from "@/server/session";
import { seedCampaignConfig } from "../helpers/campaigns";
import { resetDb } from "../helpers/db";
import { createUser, setPlan } from "../helpers/factories";
import { reportSharingWorld } from "../helpers/report-sharing";

vi.mock("@/server/session", () => ({ getSessionUser: vi.fn(async () => null) }));
describe("report capabilities and identical PDF source", () => {
  beforeEach(async () => { await resetDb(); await seedCampaignConfig(); vi.mocked(getSessionUser).mockResolvedValue(null); });

  it("stores only a 256-bit token hash, pins the public allowlist and renders without login", async () => {
    const w = await reportSharingWorld(); const issued = await createReportShare(w.db, w.user.id, w.shareInput, w.now);
    expect(Buffer.from(issued.token, "base64url")).toHaveLength(32);
    const [stored] = await w.db.select().from(reportShares); expect(stored.tokenHash).toBe(createHash("sha256").update(issued.token).digest("hex")); expect(JSON.stringify(stored)).not.toContain(issued.token);
    const shared = await sharedReport(w.db, issued.token, w.now); expect(shared?.report).toEqual(w.snapshot.data);
    const html = renderToStaticMarkup(await SharedReportPage({ params: Promise.resolve({ token: issued.token }) }));
    expect(html).toContain("1,234,567원"); expect(html).toContain("링포로 만든 리포트"); expect(html).toContain(`/join/${stored.referralCode}`);
    for (const personal of [w.user.id, w.user.email, w.account.username, w.account.igUserId, stored.tokenHash]) expect(html).not.toContain(personal);
    expect(getSessionUser).not.toHaveBeenCalled();
    await expect(createReportShare(w.db, w.user.id, w.shareInput, w.now)).rejects.toMatchObject({ code: "already_created" });
    expect(await w.db.select().from(reportShares)).toHaveLength(1);
  });

  it("revokes cached PDF and HTML access, and permits revocation after flag OFF and downgrade", async () => {
    const w = await reportSharingWorld(); const issued = await createReportShare(w.db, w.user.id, w.shareInput, w.now);
    const request = new Request(`http://localhost:3000/reports/${issued.token}/pdf`); const params = { params: Promise.resolve({ token: issued.token }) };
    const pdf = await downloadPublic(request, params); expect(pdf.status).toBe(200); expect(pdf.headers.get("content-type")).toBe("application/pdf"); expect(pdf.headers.get("cache-control")).toContain("no-store"); expect(pdf.headers.get("referrer-policy")).toBe("no-referrer"); expect((await pdf.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    await w.db.update(featureFlags).set({ enabled: false }); await setPlan(w.user.id, "free"); expect(await sharedReport(w.db, issued.token)).not.toBeNull();
    await revokeReportShare(w.db, w.user.id, issued.id); expect(await sharedReport(w.db, issued.token)).toBeNull();
    expect((await downloadPublic(request, params)).status).toBe(404); await expect(SharedReportPage(params)).rejects.toThrow();
    expect((await listReportShares(w.db, w.user.id)).items[0].revokedAt).not.toBeNull();
  });

  it("checks expiry exactly, malformed tokens, viewer PDF access and deletion", async () => {
    const w = await reportSharingWorld(); const expiresAt = new Date(+w.now + 1000);
    const issued = await createReportShare(w.db, w.user.id, { ...w.shareInput, pdfEnabled: false, expiresAt: expiresAt.toISOString() }, w.now);
    expect(await sharedReport(w.db, issued.token, new Date(+expiresAt - 1))).not.toBeNull(); expect(await sharedReport(w.db, issued.token, expiresAt)).toBeNull(); expect(await sharedReport(w.db, "bad")).toBeNull();
    expect((await downloadPublic(new Request("http://localhost/pdf"), { params: Promise.resolve({ token: issued.token }) })).status).toBe(404);
    await w.db.delete(campaigns).where(eq(campaigns.id, w.campaign.id)); expect(await sharedReport(w.db, issued.token, w.now)).toBeNull();
  });

  it("enforces owner/feature entitlements and explicit public-content review on the server", async () => {
    const w = await reportSharingWorld(); const other = await createUser();
    await expect(createReportShare(w.db, other.id, w.shareInput)).rejects.toMatchObject({ code: "not_found" });
    await expect(createReportShare(w.db, w.user.id, { ...w.shareInput, reviewedPublicContent: false })).rejects.toMatchObject({ code: "validation" });
    await w.db.update(planEntitlements).set({ booleanValue: false }).where(eq(planEntitlements.key, "campaign.report_pdf"));
    await expect(createReportShare(w.db, w.user.id, w.shareInput)).rejects.toMatchObject({ code: "entitlement" });
    const issued = await createReportShare(w.db, w.user.id, { ...w.shareInput, pdfEnabled: false });
    await expect(revokeReportShare(w.db, other.id, issued.id)).rejects.toMatchObject({ code: "not_found" });
    await setPlan(w.user.id, "free"); await expect(createReportShare(w.db, w.user.id, { ...w.shareInput, requestId: randomUUID(), pdfEnabled: false })).rejects.toMatchObject({ code: "entitlement" });
  });

  it("gates direct owner PDF downloads and provides a separate snapshot signup code", async () => {
    const w = await reportSharingWorld(); const request = new Request("http://localhost/pdf"); const params = { params: Promise.resolve({ id: w.campaign.id, snapshotId: w.snapshot.id }) };
    expect((await downloadOwner(request, params)).status).toBe(401);
    vi.mocked(getSessionUser).mockResolvedValue(w.user); expect((await downloadOwner(request, params)).status).toBe(200);
    expect(w.snapshot.referralCode).toMatch(/^[a-f0-9]{32}$/);
    await setPlan(w.user.id, "free"); expect((await downloadOwner(request, params)).status).toBe(403);
    vi.mocked(getSessionUser).mockResolvedValue(await createUser()); expect((await downloadOwner(request, params)).status).toBe(404);
  });

  it("paginates older issued links so every link remains revocable", async () => {
    const w = await reportSharingWorld();
    for (let n = 0; n < 51; n++) await createReportShare(w.db, w.user.id, { ...w.shareInput, requestId: randomUUID() }, w.now);
    const first = await listReportShares(w.db, w.user.id); expect(first.items).toHaveLength(50); expect(first.nextCursor).not.toBeNull();
    const next = await listReportShares(w.db, w.user.id, undefined, first.nextCursor!); expect(next.items).toHaveLength(1); expect(next.nextCursor).toBeNull();
    expect(new Set([...first.items, ...next.items].map((s) => s.id)).size).toBe(51); expect((await listReportShares(w.db, (await createUser()).id)).items).toHaveLength(0);
    await expect(listReportShares(w.db, w.user.id, undefined, "bad")).rejects.toMatchObject({ code: "validation" });
  });
});
