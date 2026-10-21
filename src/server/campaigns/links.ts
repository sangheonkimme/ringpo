import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db, Executor } from "@/server/db/client";
import { campaignClickEvents, campaignLinkCatalogs, campaignProducts, campaignTrackedLinks, type Campaign, type CampaignParticipant, type DmJob } from "@/server/db/schema";
import { generateCode, isBotUserAgent } from "@/server/links";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const validCode = (code: string) => /^[0-9A-Za-z]{22}$/.test(code);

export function campaignTargetUrl(original: string, slug: string, product: { name: string; option: string }): string {
  const url = new URL(original);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid_campaign_product_url");
  url.searchParams.set("utm_source", "instagram");
  url.searchParams.set("utm_medium", "dm");
  url.searchParams.set("utm_campaign", slug);
  url.searchParams.set("utm_content", [product.name, product.option].filter(Boolean).join(" / "));
  return url.toString();
}

/** Store immutable destinations. Edits create new codes; links already delivered keep working. */
export async function campaignPurchaseLink(db: Executor, context: { campaign: Campaign; participant: CampaignParticipant; job: DmJob }, appUrl: string): Promise<{ url: string; productName: string } | null> {
  const { campaign, participant, job } = context;
  const products = await db.select().from(campaignProducts).where(and(eq(campaignProducts.campaignId, campaign.id), isNull(campaignProducts.archivedAt))).orderBy(asc(campaignProducts.sortOrder), asc(campaignProducts.id));
  if (!products.length) return null;
  const targets = products.map((product) => {
    const targetUrl = campaignTargetUrl(product.originalUrl, campaign.slug, product);
    return { product, targetUrl, targetHash: hash(targetUrl) };
  });
  const codes = new Map<string, string>();
  // ON CONFLICT also covers the extraordinarily unlikely random-code collision. Retry only missing rows.
  for (let attempt = 0; attempt < 3 && codes.size !== products.length; attempt++) {
    await db.insert(campaignTrackedLinks).values(targets.filter(({ product }) => !codes.has(product.id)).map(({ product, targetUrl, targetHash }) => ({
      code: generateCode(22), campaignId: campaign.id, productId: product.id, jobId: job.id, recipientHash: participant.recipientHash, targetUrl, targetHash,
    }))).onConflictDoNothing();
    const rows = await db.select({ productId: campaignTrackedLinks.productId, targetHash: campaignTrackedLinks.targetHash, code: campaignTrackedLinks.code }).from(campaignTrackedLinks)
      .where(and(eq(campaignTrackedLinks.jobId, job.id), inArray(campaignTrackedLinks.targetHash, targets.map((target) => target.targetHash))));
    for (const target of targets) {
      const row = rows.find((row) => row.productId === target.product.id && row.targetHash === target.targetHash);
      if (row) codes.set(row.productId, row.code);
    }
  }
  if (codes.size !== products.length) throw new Error("campaign_link_code_allocation_failed");
  const origin = new URL(appUrl).origin;
  if (products.length === 1) return { url: `${origin}/r/${codes.get(products[0].id)}`, productName: products[0].name };
  const choices = products.map((product) => ({ name: product.name, option: product.option, code: codes.get(product.id)! }));
  const contentHash = hash(JSON.stringify([campaign.title, campaign.brand, choices]));
  for (let attempt = 0; attempt < 3; attempt++) {
    await db.insert(campaignLinkCatalogs).values({ code: generateCode(22), campaignId: campaign.id, jobId: job.id, contentHash, title: campaign.title, brand: campaign.brand, products: choices }).onConflictDoNothing();
    const [catalog] = await db.select({ code: campaignLinkCatalogs.code }).from(campaignLinkCatalogs).where(and(eq(campaignLinkCatalogs.jobId, job.id), eq(campaignLinkCatalogs.contentHash, contentHash)));
    if (catalog) return { url: `${origin}/c/${catalog.code}`, productName: campaign.title };
  }
  throw new Error("campaign_catalog_code_allocation_failed");
}

export function countCampaignClick(req: Request): boolean {
  return req.method === "GET" && !isBotUserAgent(req.headers.get("user-agent")) &&
    !/meta-externalfetcher/i.test(req.headers.get("user-agent") ?? "") &&
    !/prefetch|prerender|preview/i.test([req.headers.get("purpose"), req.headers.get("sec-purpose"), req.headers.get("x-purpose")].join(" "));
}

/** The event and cached counter commit together. No IP address, user agent, or raw recipient ID is stored. */
export async function resolveCampaignClick(db: Db, code: string, countClick: boolean, now?: Date): Promise<string | null> {
  if (!validCode(code)) return null;
  return db.transaction(async (tx) => {
    const [link] = await tx.select().from(campaignTrackedLinks).where(eq(campaignTrackedLinks.code, code));
    if (!link) return null;
    const url = new URL(link.targetUrl);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (countClick) {
      const at = now ?? (await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`))[0].now;
      // A concurrent data-deletion callback either removes this event too or causes a rollback.
      await tx.insert(campaignClickEvents).values({ linkId: link.id, campaignId: link.campaignId, productId: link.productId, recipientHash: link.recipientHash, clickedAt: new Date(at) });
      await tx.update(campaignTrackedLinks).set({ clickCount: sql`${campaignTrackedLinks.clickCount} + 1`,
        firstClickedAt: sql`least(coalesce(${campaignTrackedLinks.firstClickedAt}, ${new Date(at).toISOString()}::timestamptz), ${new Date(at).toISOString()}::timestamptz)`,
        lastClickedAt: sql`greatest(${campaignTrackedLinks.lastClickedAt}, ${new Date(at).toISOString()}::timestamptz)`,
      }).where(eq(campaignTrackedLinks.id, link.id));
    }
    return link.targetUrl;
  });
}

/** Public allowlist: no campaign owner, recipient hash, job ID, or Instagram identity. */
export async function campaignCatalog(db: Executor, code: string) {
  if (!validCode(code)) return null;
  const [catalog] = await db.select({ title: campaignLinkCatalogs.title, brand: campaignLinkCatalogs.brand, products: campaignLinkCatalogs.products }).from(campaignLinkCatalogs).where(eq(campaignLinkCatalogs.code, code));
  return catalog ?? null;
}

export async function campaignClickSummary(db: Executor, campaignId: string) {
  // Dashboard polling reads per-link counters instead of repeatedly scanning the growing click history.
  const [summary] = await db.select({ total: sql<number>`coalesce(sum(${campaignTrackedLinks.clickCount}), 0)::int`, unique: sql<number>`count(distinct ${campaignTrackedLinks.recipientHash})::int` }).from(campaignTrackedLinks)
    .where(and(eq(campaignTrackedLinks.campaignId, campaignId), sql`${campaignTrackedLinks.clickCount} > 0`));
  return summary;
}
