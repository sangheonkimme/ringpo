import { createHash } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { campaignReportSchema } from "@/lib/campaign-report";
import { randomToken } from "@/server/crypto";
import type { Db, Executor } from "@/server/db/client";
import { campaigns, reportReferralSignups, reportShares, reportSnapshots } from "@/server/db/schema";
import { CampaignError, requireCampaignFeature } from "./access";
import { requireReportCampaign } from "./report";
import { databaseNow } from "./send-budget";

export const REPORT_HEADERS = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive", "X-Content-Type-Options": "nosniff" };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export const validReportToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
const shareInput = z.object({ campaignId: z.uuid(), snapshotId: z.uuid(), requestId: z.uuid(), reviewedPublicContent: z.literal(true), pdfEnabled: z.boolean(), expiresAt: z.iso.datetime().nullable() });

/** The raw capability is returned only once. Storage and owner lists never retain it. */
export async function createReportShare(db: Db, userId: string, raw: unknown, at?: Date) {
  const parsed = shareInput.safeParse(raw); if (!parsed.success) throw new CampaignError("validation", "공개 내용과 공유 설정을 확인해주세요");
  const input = parsed.data;
  return db.transaction(async (tx) => {
    const campaign = await requireReportCampaign(tx, userId, input.campaignId);
    await requireCampaignFeature(tx, userId, "campaign.report_share");
    if (input.pdfEnabled) await requireCampaignFeature(tx, userId, "campaign.report_pdf");
    const now = at ?? await databaseNow(tx); const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= now) throw new CampaignError("validation", "공유 만료 시각은 현재보다 뒤여야 해요");
    const [snapshot] = await tx.select().from(reportSnapshots).where(and(eq(reportSnapshots.id, input.snapshotId), eq(reportSnapshots.campaignId, campaign.id)));
    if (!snapshot) throw new CampaignError("not_found", "공유할 리포트 버전을 찾을 수 없어요");
    campaignReportSchema.parse(snapshot.data);
    const token = randomToken(32);
    const [share] = await tx.insert(reportShares).values({ campaignId: campaign.id, snapshotId: snapshot.id, tokenHash: hash(token), referralCode: randomToken(12), requestId: input.requestId,
      createdBy: userId, pdfEnabled: input.pdfEnabled, expiresAt, createdAt: now }).onConflictDoNothing().returning({ id: reportShares.id });
    if (!share) throw new CampaignError("already_created", "이미 처리한 공유 요청이에요. 목록에서 기존 링크를 폐기하거나 새 링크를 만들어주세요");
    return { id: share.id, token };
  });
}

/** Issued read capabilities survive flag/plan changes; explicit revocation, expiry or deletion ends them. */
export async function sharedReport(db: Executor, token: string, at?: Date) {
  if (!validReportToken(token)) return null;
  const now = at ?? await databaseNow(db);
  const [row] = await db.select({ id: reportShares.id, pdfEnabled: reportShares.pdfEnabled, referralCode: reportShares.referralCode, expiresAt: reportShares.expiresAt, revision: reportSnapshots.revision, data: reportSnapshots.data })
    .from(reportShares).innerJoin(reportSnapshots, and(eq(reportSnapshots.id, reportShares.snapshotId), eq(reportSnapshots.campaignId, reportShares.campaignId)))
    .where(and(eq(reportShares.tokenHash, hash(token)), isNull(reportShares.revokedAt)));
  if (!row || (row.expiresAt && row.expiresAt <= now)) return null;
  // Only the parsed aggregate reaches HTML/PDF. id is internal for cache/revocation, never a viewer identity.
  return { id: row.id, revision: row.revision, report: campaignReportSchema.parse(row.data), pdfEnabled: row.pdfEnabled, referralCode: row.referralCode };
}

export async function listReportShares(db: Executor, userId: string, campaignId?: string, before?: string) {
  let cursor: { at: string; id: string } | undefined;
  if (before) {
    try { if (before.length > 200) throw new Error(); cursor = z.object({ at: z.iso.datetime(), id: z.uuid() }).parse(JSON.parse(Buffer.from(before, "base64url").toString())); }
    catch { throw new CampaignError("validation", "공유 링크 목록의 페이지를 확인해주세요"); }
  }
  const rows = await db.select({ id: reportShares.id, campaignId: reportShares.campaignId, title: campaigns.title, revision: reportSnapshots.revision, createdAt: reportShares.createdAt,
    expiresAt: reportShares.expiresAt, revokedAt: reportShares.revokedAt, pdfEnabled: reportShares.pdfEnabled, signups: sql<number>`(select count(*)::int from ${reportReferralSignups} r where r.share_id = ${reportShares.id})` })
    .from(reportShares).innerJoin(campaigns, eq(campaigns.id, reportShares.campaignId)).innerJoin(reportSnapshots, eq(reportSnapshots.id, reportShares.snapshotId))
    .where(and(eq(campaigns.userId, userId), campaignId ? eq(campaigns.id, campaignId) : undefined,
      cursor ? sql`(${reportShares.createdAt}, ${reportShares.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : undefined))
    .orderBy(desc(reportShares.createdAt), desc(reportShares.id)).limit(51);
  const items = rows.slice(0, 50).map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt?.toISOString() ?? null, revokedAt: row.revokedAt?.toISOString() ?? null }));
  const last = items.at(-1);
  return { items, nextCursor: rows.length > 50 && last ? Buffer.from(JSON.stringify({ at: last.createdAt, id: last.id })).toString("base64url") : null };
}

/** Owner can always revoke, including after downgrade, archival, disconnection or feature kill switch. */
export async function revokeReportShare(db: Executor, userId: string, shareId: string, at?: Date) {
  if (!z.uuid().safeParse(shareId).success) throw new CampaignError("not_found", "공유 링크를 찾을 수 없어요");
  const [share] = await db.select({ id: reportShares.id }).from(reportShares).innerJoin(campaigns, eq(campaigns.id, reportShares.campaignId)).where(and(eq(reportShares.id, shareId), eq(campaigns.userId, userId)));
  if (!share) throw new CampaignError("not_found", "공유 링크를 찾을 수 없어요");
  await db.update(reportShares).set({ revokedAt: at ?? await databaseNow(db), revokedBy: userId }).where(and(eq(reportShares.id, shareId), isNull(reportShares.revokedAt)));
}


export async function reportReferralSummary(db: Executor, userId: string, campaignId: string) {
  const [counts] = await db.select({ total: sql<number>`count(*)::int`, directPdf: sql<number>`(count(*) filter (where ${reportReferralSignups.shareId} is null))::int` })
    .from(reportReferralSignups).innerJoin(reportSnapshots, eq(reportSnapshots.id, reportReferralSignups.snapshotId)).innerJoin(campaigns, eq(campaigns.id, reportSnapshots.campaignId))
    .where(and(eq(campaigns.userId, userId), eq(campaigns.id, campaignId)));
  return counts;
}
