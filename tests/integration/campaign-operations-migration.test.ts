import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CAMPAIGN_TEMPLATES } from "@/lib/campaign-schema";
import { campaigns, campaignParticipants, dmJobs, commentEvents, igAccounts, user } from "@/server/db/schema";
import { resetDb } from "../helpers/db";
import { migrationDatabase } from "../helpers/migrations";
describe("operations migration", () => {
  beforeEach(resetDb);
  it("supports empty up/down/up without changing retention records", async () => {
    const db = await migrationDatabase(13);
    try {
      await db.down("drizzle/rollback/0013_gonggu_operations.sql");
      expect((await db.sql`select value from campaign_policies where key='raw_content_retention_days'`)[0].value).toBe(90);
      await db.up(); expect((await db.sql`select value from campaign_policies where key='manual_retry_extra_attempts'`)[0].value).toBe(5);
    } finally { await db.close(); }
  });
  it("refuses to erase a recorded manual retry budget", async () => {
    const m = await migrationDatabase(13); const now = new Date();
    try {
      await m.db.insert(user).values({ id: "fixture", name: "fixture", email: "fixture@example.com" });
      const [account] = await m.db.insert(igAccounts).values({ userId: "fixture", igUserId: "business", username: "fixture", accountType: "BUSINESS" }).returning();
      const [campaign] = await m.db.insert(campaigns).values({ userId: "fixture", igAccountId: account.id, title: "fixture", slug: "fixture", openAt: now, closeAt: new Date(+now + 86_400_000), templates: DEFAULT_CAMPAIGN_TEMPLATES, notificationKeywords: ["알림"], linkKeywords: ["링크"], hourlyRate: 400 }).returning();
      const [participant] = await m.db.insert(campaignParticipants).values({ campaignId: campaign.id, igAccountId: account.id, commenterIgId: "peer", recipientHash: "a".repeat(64), firstCommentCreatedAt: now }).returning();
      const [event] = await m.db.insert(commentEvents).values({ igAccountId: account.id, campaignId: campaign.id, commentId: "comment", commenterIgId: "peer", mediaId: "media" }).returning();
      await m.db.insert(dmJobs).values({ campaignId: campaign.id, igAccountId: account.id, participantId: participant.id, sourceEventId: event.id, channel: "private_reply", kind: "instant_link", scheduledAt: now, nextAttemptAt: now, deadlineAt: new Date(+now + 86_400_000), hardExpiresAt: new Date(+now + 90_000_000), commentCreatedAt: now, idempotencyKey: "fixture-key", retryAllowance: 5 });
      await expect(m.down("drizzle/rollback/0013_gonggu_operations.sql")).rejects.toThrow();
      expect((await m.sql`select retry_allowance from dm_jobs`)[0].retry_allowance).toBe(5);
    } finally { await m.close(); }
  });
});
