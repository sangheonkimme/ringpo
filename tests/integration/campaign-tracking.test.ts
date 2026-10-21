import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { campaignClickEvents, campaignLinkCatalogs, campaignMedia, campaignParticipants, campaignProducts, campaigns, campaignTrackedLinks, commentEvents, dmJobs, featureFlags, igAccounts } from "@/server/db/schema";
import { campaignCatalog, campaignClickSummary, campaignPurchaseLink, resolveCampaignClick } from "@/server/campaigns/links";
import { renderCampaignMessage } from "@/server/campaigns/render";
import { getSendOverview } from "@/server/campaigns/send-controls";
import { dispatchCampaignJob } from "@/server/campaigns/dispatch";
import { claimCampaignJobs } from "@/server/campaigns/jobs";
import { decryptSecret } from "@/server/crypto";
import { FakeGraphClient } from "../helpers/fake-graph";
import { GET, HEAD } from "@/app/r/[code]/route";
import { resetDb } from "../helpers/db";
import { seedDispatchLoad } from "../helpers/campaign-dispatch";
import { CAMPAIGN_NOW, seedCampaignConfig } from "../helpers/campaigns";

async function world(productCount = 1) {
  const db = getDb(); await seedDispatchLoad(1, 2, CAMPAIGN_NOW);
  const [campaign] = await db.select().from(campaigns);
  const [job] = await db.select().from(dmJobs).orderBy(dmJobs.id);
  const [participant] = await db.select().from(campaignParticipants).where(eq(campaignParticipants.id, job.participantId));
  const [event] = await db.select().from(commentEvents).where(eq(commentEvents.id, job.sourceEventId!));
  const products = await db.insert(campaignProducts).values(Array.from({ length: productCount }, (_, i) => ({ campaignId: campaign.id, name: `크림 ${i}`, option: `${i + 1}개`, originalUrl: `https://shop.example/p/${i}?existing=1&utm_source=old#option`, sortOrder: i }))).returning();
  await db.insert(campaignMedia).values({ campaignId: campaign.id, igAccountId: campaign.igAccountId, mediaId: event.mediaId, permalink: "https://instagram.com/p/fixture/" });
  const context = { campaign, job, participant, event };
  const purchase = () => db.transaction((tx) => campaignPurchaseLink(tx, context, "https://ringpo.test"));
  return { db, campaign, job, participant, event, products, context, purchase };
}

describe("campaign tracking and latest message rendering", () => {
  beforeEach(async () => { await resetDb(); await seedCampaignConfig(); });

  it("reserves one immutable code during concurrent rendering and preserves original query/fragment with campaign UTM", async () => {
    const w = await world();
    const results = await Promise.all(Array.from({ length: 8 }, w.purchase));
    expect(new Set(results.map((link) => link!.url)).size).toBe(1);
    const [stored] = await w.db.select().from(campaignTrackedLinks); const url = new URL(stored.targetUrl);
    expect(url.hash).toBe("#option"); expect(url.searchParams.get("existing")).toBe("1");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ utm_source: "instagram", utm_medium: "dm", utm_campaign: w.campaign.slug, utm_content: "크림 0 / 1개" });
    expect(stored.code).toMatch(/^[A-Za-z0-9]{22}$/);
    await w.db.update(campaignProducts).set({ originalUrl: "https://shop.example/new" }).where(eq(campaignProducts.id, w.products[0].id));
    expect((await w.purchase())!.url).not.toBe(results[0]!.url);
    expect(await resolveCampaignClick(w.db, stored.code, false)).toBe(stored.targetUrl);
  });

  it("offers every product without leaking identities and keeps delivered catalogs unchanged after edits", async () => {
    const w = await world(3); const first = await w.purchase(); const code = first!.url.split("/").at(-1)!;
    expect(first!.url).toContain("/c/");
    const catalog = await campaignCatalog(w.db, code); expect(catalog!.products).toHaveLength(3);
    expect(Object.keys(catalog!).sort()).toEqual(["brand", "products", "title"]);
    for (const item of catalog!.products) expect(Object.keys(item).sort()).toEqual(["code", "name", "option"]);
    const json = JSON.stringify(catalog);
    for (const privateValue of [w.participant.commenterIgId, w.participant.recipientHash, w.campaign.userId, w.job.id]) expect(json).not.toContain(privateValue);
    await w.db.update(campaignProducts).set({ archivedAt: CAMPAIGN_NOW }).where(eq(campaignProducts.id, w.products[0].id));
    const next = await w.purchase(); expect(next!.url).not.toBe(first!.url);
    expect((await campaignCatalog(w.db, next!.url.split("/").at(-1)!))!.products).toHaveLength(2);
    expect(await campaignCatalog(w.db, code)).toEqual(catalog);
    await w.db.delete(dmJobs).where(eq(dmJobs.id, w.job.id));
    expect(await campaignCatalog(w.db, code)).toEqual(catalog);
    expect((await w.db.select().from(campaignLinkCatalogs)).every((row) => row.jobId === null)).toBe(true);
  });

  it("counts concurrent human requests atomically and distinguishes recipient-level unique clicks across products", async () => {
    const w = await world(2); await w.purchase(); const rows = await w.db.select().from(campaignTrackedLinks);
    await Promise.all(Array.from({ length: 25 }, (_, i) => resolveCampaignClick(w.db, rows[i % 2].code, true, new Date(CAMPAIGN_NOW.getTime() + i * 1000))));
    expect(await campaignClickSummary(w.db, w.campaign.id)).toEqual({ total: 25, unique: 1 });
    const counters = await w.db.select().from(campaignTrackedLinks);
    expect(counters.reduce((sum, row) => sum + row.clickCount, 0)).toBe(25);
    expect(Math.max(...counters.map((row) => row.lastClickedAt!.getTime()))).toBe(CAMPAIGN_NOW.getTime() + 24_000);
    const events = await w.db.select().from(campaignClickEvents); expect(events).toHaveLength(25);
    expect(Object.keys(events[0]).sort()).toEqual(["campaignId", "clickedAt", "id", "linkId", "productId", "recipientHash"]);
    const overview = await getSendOverview(w.db, w.campaign.userId, w.campaign.igAccountId, w.campaign.id);
    expect(overview.clicks).toEqual({ total: 25, unique: 1 });
    const otherJob = (await w.db.select().from(dmJobs)).find((row) => row.id !== w.job.id)!;
    const [otherPerson] = await w.db.select().from(campaignParticipants).where(eq(campaignParticipants.id, otherJob.participantId));
    await w.db.transaction((tx) => campaignPurchaseLink(tx, { campaign: w.campaign, job: otherJob, participant: otherPerson }, "https://ringpo.test"));
    const [otherLink] = await w.db.select().from(campaignTrackedLinks).where(eq(campaignTrackedLinks.jobId, otherJob.id));
    await resolveCampaignClick(w.db, otherLink.code, true);
    expect(await campaignClickSummary(w.db, w.campaign.id)).toEqual({ total: 26, unique: 2 });
    await expect(getSendOverview(w.db, "outsider", w.campaign.igAccountId, w.campaign.id)).rejects.toThrow("찾을 수 없어요");
  });

  it("302 redirects crawler, HEAD, prefetch and human requests but only counts the human GET, including after flag-off", async () => {
    const w = await world(); const link = await w.purchase(); const code = link!.url.split("/").at(-1)!;
    await w.db.update(featureFlags).set({ enabled: false });
    const ctx = { params: Promise.resolve({ code }) };
    for (const ua of ["facebookexternalhit/1.1", "meta-externalagent/1.1", "Meta-ExternalFetcher/1.1", "Facebot", "Twitterbot/1.0", ""]) {
      const response = await GET(new Request(link!.url, { headers: { "user-agent": ua } }), ctx); expect(response.status).toBe(302);
    }
    const human = { "user-agent": "Mozilla/5.0 (iPhone) Instagram 350" };
    expect((await HEAD(new Request(link!.url, { method: "HEAD", headers: human }), ctx)).status).toBe(302);
    expect((await GET(new Request(link!.url, { headers: { ...human, "sec-purpose": "prefetch;prerender" } }), ctx)).status).toBe(302);
    expect(await campaignClickSummary(w.db, w.campaign.id)).toEqual({ total: 0, unique: 0 });
    const response = await GET(new Request(`${link!.url}?url=https://attacker.test`, { headers: human }), ctx);
    expect(response.headers.get("location")).toContain("https://shop.example/p/0?");
    expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await campaignClickSummary(w.db, w.campaign.id)).toEqual({ total: 1, unique: 1 });
    expect((await HEAD(new Request(link!.url, { method: "HEAD" }), { params: Promise.resolve({ code: "../bad" }) })).status).toBe(404);
    expect(await campaignCatalog(w.db, "invalid")).toBeNull();
  });

  it("renders phase templates, rotates public replies, preserves fallback links and never reveals a purchase link in the follow gate", async () => {
    const w = await world();
    const render = () => w.db.transaction((tx) => renderCampaignMessage(tx, w.context, "https://ringpo.test"));
    const sent = await render(); expect(sent).toMatchObject({ kind: "button", text: "크림 0 공구 구매 링크예요.", buttonTitle: "상품 보러 가기" });
    w.context.campaign.templates.open.privateReply = "수정된 {상품명} 안내 {링크}";
    w.context.job.messageFormat = "text"; const text = await render(); expect(text!.text).toContain("수정된 크림 0 안내 https://ringpo.test/r/");
    w.context.job.kind = "follow_request"; w.context.campaign.templates.follow = "가".repeat(590);
    const follow = await render(); expect(follow!.text).toContain("팔로우했어요"); expect(follow!.text).not.toContain("/r/"); expect(Buffer.byteLength(follow!.text)).toBeLessThanOrEqual(1000);
    w.context.job.kind = "expiry_fallback"; w.context.campaign.templates.expiry = "가".repeat(600);
    const expiry = await render(); expect(expiry!.text).toContain("https://instagram.com/p/fixture/"); expect(expiry!.text).toContain("한국 시간"); expect(Buffer.byteLength(expiry!.text)).toBeLessThanOrEqual(1000);
    w.context.job.kind = "closed_notice"; w.context.campaign.status = "sold_out";
    expect((await render())!.text).toContain("품절");
    w.context.job.channel = "public_reply"; w.context.event.stateAtReceipt = "open"; w.context.job.publicTemplateIndex = 1;
    expect((await render())!.text).toBe(w.campaign.templates.open.publicReplies[1]);
    w.context.event.stateAtReceipt = "teaser"; expect((await render())!.text).toContain("알림 신청 완료");
    w.context.campaign.templates.teaser.publicReplies = []; expect(await render()).toBeNull();
  });

  it("cascades account deletion to all hashed click data and public links", async () => {
    const w = await world(2); const link = await w.purchase(); const [tracked] = await w.db.select().from(campaignTrackedLinks);
    await resolveCampaignClick(w.db, tracked.code, true);
    await w.db.delete(igAccounts).where(eq(igAccounts.id, w.campaign.igAccountId));
    expect(await w.db.select().from(campaignClickEvents)).toHaveLength(0);
    expect(await resolveCampaignClick(w.db, tracked.code, false)).toBeNull();
    expect(await campaignCatalog(w.db, link!.url.split("/").at(-1)!)).toBeNull();
  });

  it("sends through the durable dispatcher with the real renderer, then resolves the delivered catalog and click", async () => {
    const w = await world(2); const graph = new FakeGraphClient(); let now = CAMPAIGN_NOW;
    const deps = { db: w.db, graph, decryptToken: decryptSecret, random: () => 0, clock: async () => now,
      render: (db: Parameters<typeof renderCampaignMessage>[0], context: Parameters<typeof renderCampaignMessage>[1]) => renderCampaignMessage(db, context, "https://ringpo.test") };
    for (const job of await claimCampaignJobs(w.db, { batch: 10, now, workerId: "tracking" })) await dispatchCampaignJob(deps, job);
    expect(graph.dms).toHaveLength(0); now = new Date(now.getTime() + 3000);
    const [job] = await claimCampaignJobs(w.db, { batch: 10, now, workerId: "tracking" });
    expect(await dispatchCampaignJob(deps, job)).toBe("sent");
    expect(await dispatchCampaignJob(deps, job)).toBe("stale_lease"); expect(graph.dms).toHaveLength(1);
    const message = graph.dms[0].message; if (message.kind !== "button") throw new Error("expected product catalog button");
    const catalog = await campaignCatalog(w.db, message.url.split("/").at(-1)!);
    expect(catalog!.products).toHaveLength(2);
    const response = await GET(new Request(`https://ringpo.test/r/${catalog!.products[1].code}`, { headers: { "user-agent": "Mozilla/5.0 Instagram" } }), { params: Promise.resolve({ code: catalog!.products[1].code }) });
    expect(response.status).toBe(302); expect(await campaignClickSummary(w.db, w.campaign.id)).toEqual({ total: 1, unique: 1 });
  });
});
