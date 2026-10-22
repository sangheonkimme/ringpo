import { createHmac } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { safeEqual } from "@/server/crypto";
import type { Executor } from "@/server/db/client";
import { reportShares, reportSnapshots, user } from "@/server/db/schema";

export const REPORT_REFERRAL_COOKIE = "ringpo_report_ref";
export const REPORT_REFERRAL_SECONDS = 30 * 24 * 60 * 60;
export const validReferralCode = (code: string) => /^(?:[A-Za-z0-9_-]{16}|[a-f0-9]{32})$/.test(code);
const signature = (payload: string, secret: string) => createHmac("sha256", secret).update(`report-referral:v1:${payload}`).digest("base64url");

export function signReportReferral(code: string, now: Date, secret: string) {
  if (!validReferralCode(code)) throw new Error("invalid_referral_code");
  const payload = `${code}.${now.getTime()}`; return `${payload}.${signature(payload, secret)}`;
}
export function parseReportReferral(value: string | undefined, now: Date, secret: string) {
  if (!value || value.length > 128) return null;
  const [code, time, sig, extra] = value.split(".");
  if (!validReferralCode(code ?? "") || !/^\d{13}$/.test(time ?? "") || !sig || extra !== undefined || !safeEqual(sig, signature(`${code}.${time}`, secret))) return null;
  const touchedAt = new Date(Number(time)); const age = now.getTime() - touchedAt.getTime();
  return age < 0 || age >= REPORT_REFERRAL_SECONDS * 1000 ? null : { code, touchedAt };
}
export function referralCookieValue(header: string | null | undefined) {
  return header?.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${REPORT_REFERRAL_COOKIE}=`))?.slice(REPORT_REFERRAL_COOKIE.length + 1);
}

/** Referral code is public attribution metadata and cannot open the private report. */
export async function activeReportReferral(db: Executor, code: string, now: Date) {
  if (!validReferralCode(code)) return false;
  const [share] = await db.select({ expiresAt: reportShares.expiresAt }).from(reportShares).where(and(eq(reportShares.referralCode, code), isNull(reportShares.revokedAt)));
  if (share) return !share.expiresAt || share.expiresAt > now;
  const [snapshot] = await db.select({ id: reportSnapshots.id }).from(reportSnapshots).where(eq(reportSnapshots.referralCode, code));
  return Boolean(snapshot);
}

/** Called on new-user creation and retried on session creation; an existing user cannot become a new signup. */
export async function attributeReportSignup(db: Executor, userId: string, cookieHeader: string | null | undefined, secret: string, now: Date) {
  const touch = parseReportReferral(referralCookieValue(cookieHeader), now, secret); if (!touch) return false;
  const [account] = await db.select({ createdAt: user.createdAt }).from(user).where(eq(user.id, userId));
  if (!account || account.createdAt < touch.touchedAt || account.createdAt.getTime() >= touch.touchedAt.getTime() + REPORT_REFERRAL_SECONDS * 1000) return false;
  // A signup can still be attributed to a valid earlier visit after that share expires or is revoked.
  const rows = await db.execute(sql`
    insert into report_referral_signups (user_id, share_id, snapshot_id, touched_at, created_at)
    select ${userId}, source.share_id, source.snapshot_id, ${touch.touchedAt.toISOString()}::timestamptz, ${account.createdAt.toISOString()}::timestamptz
    from (
      select s.id as share_id, s.snapshot_id from report_shares s where s.referral_code = ${touch.code}
      union all
      select null::uuid as share_id, r.id as snapshot_id from report_snapshots r where r.referral_code = ${touch.code}
    ) source
    on conflict (user_id) do nothing returning user_id
  `);
  return rows.length > 0;
}
