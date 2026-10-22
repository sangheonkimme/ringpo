import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { campaignNotificationOutbox, igAccounts, user } from "@/server/db/schema";
import { sendEmail } from "@/server/email";
import { emails } from "@/server/emails";
import { campaignPolicy } from "./access";

export async function sendCampaignNotifications(db: Db, now: Date, send: typeof sendEmail = sendEmail) {
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx.select({ id: campaignNotificationOutbox.id }).from(campaignNotificationOutbox).where(or(
      and(eq(campaignNotificationOutbox.status, "waiting"), lte(campaignNotificationOutbox.nextAttemptAt, now)),
      and(eq(campaignNotificationOutbox.status, "sending"), lt(campaignNotificationOutbox.leaseUntil, now)),
    )).orderBy(asc(campaignNotificationOutbox.nextAttemptAt)).limit(10).for("update", { skipLocked: true });
    if (!rows.length) return [];
    return tx.update(campaignNotificationOutbox).set({ status: "sending", attempts: sql`${campaignNotificationOutbox.attempts} + 1`, leaseUntil: new Date(now.getTime() + 60_000) }).where(inArray(campaignNotificationOutbox.id, rows.map((r) => r.id))).returning();
  });
  let sent = 0;
  if (!claimed.length) return sent;
  const maxAttempts = await campaignPolicy(db, "max_attempts");
  for (const notification of claimed) {
    const where = and(eq(campaignNotificationOutbox.id, notification.id), eq(campaignNotificationOutbox.status, "sending"), eq(campaignNotificationOutbox.attempts, notification.attempts));
    const [recipient] = await db.select({ email: user.email, username: igAccounts.username }).from(user).innerJoin(igAccounts, eq(igAccounts.userId, user.id)).where(and(eq(user.id, notification.userId), eq(igAccounts.id, notification.igAccountId)));
    if (!recipient) { await db.update(campaignNotificationOutbox).set({ status: "failed", leaseUntil: null }).where(where); continue; }
    try {
      const content = notification.kind === "reauth_required" ? emails.reauthRequired(recipient.username) : notification.kind === "operations_attention" ? emails.campaignAttention(recipient.username, notification.reason) : emails.campaignPaused(recipient.username, notification.resumeAt);
      await send({ to: recipient.email, ...content }, { idempotencyKey: `gonggu-notification/${notification.id}`, requireConfigured: true });
      await db.update(campaignNotificationOutbox).set({ status: "sent", leaseUntil: null }).where(where); sent++;
    } catch {
      await db.update(campaignNotificationOutbox).set({ status: notification.attempts >= maxAttempts ? "failed" : "waiting", leaseUntil: null, nextAttemptAt: new Date(now.getTime() + 60_000 * 2 ** Math.min(notification.attempts, 6)) }).where(where);
    }
  }
  return sent;
}
