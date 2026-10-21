import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/server/db/client";
import { accountSendAuditEvents, accountSendControls, campaignNotificationOutbox, sendBuckets } from "@/server/db/schema";
import { updateSendControls } from "@/server/campaigns/send-controls";
import { sendCampaignNotifications } from "@/server/campaigns/notifications";
import { CAMPAIGN_NOW, seedCampaignConfig } from "../helpers/campaigns";
import { createIgAccount, createUser } from "../helpers/factories";
import { resetDb } from "../helpers/db";

describe("seller send safety controls", () => {
  beforeEach(async () => { await resetDb(); await seedCampaignConfig(); });
  it("authorizes ownership, fences concurrent edits, audits changes, and preserves rolling budgets on resume", async () => {
    const db = getDb(); const owner = await createUser(); const outsider = await createUser(); const account = await createIgAccount(owner.id);
    const input = { accountId: account.id, expectedVersion: 0, requestId: randomUUID(), manualPaused: true, privateReplyRate: 400, continueDmOnPublicPause: false };
    await expect(updateSendControls(db, outsider.id, input, CAMPAIGN_NOW)).rejects.toThrow("찾을 수 없어요");
    await updateSendControls(db, owner.id, input, CAMPAIGN_NOW); await updateSendControls(db, owner.id, input, CAMPAIGN_NOW);
    expect(await db.select().from(accountSendAuditEvents)).toHaveLength(1);
    expect((await db.select().from(accountSendControls))[0].manualPaused).toBe(true);
    const later = new Date(CAMPAIGN_NOW.getTime() + 600_000);
    await db.update(sendBuckets).set({ tokens: 0, pausedUntil: later, nextEligibleAt: later, requiresReview: true });
    await expect(updateSendControls(db, owner.id, { ...input, requestId: randomUUID() }, CAMPAIGN_NOW)).rejects.toThrow("변경");
    await updateSendControls(db, owner.id, { ...input, expectedVersion: 2, requestId: randomUUID(), manualPaused: false, acknowledgePolicyReview: true }, CAMPAIGN_NOW);
    const buckets = await db.select().from(sendBuckets); expect(buckets.every((b) => b.tokens === 0 && b.pausedUntil?.getTime() === later.getTime() && !b.requiresReview)).toBe(true);
    await expect(updateSendControls(db, owner.id, { ...input, expectedVersion: 3, requestId: randomUUID(), privateReplyRate: 751 }, CAMPAIGN_NOW)).rejects.toThrow("초과");
  });

  it("retains missing-provider notifications for retry and shares one idempotency key across workers", async () => {
    const db = getDb(); const owner = await createUser(); const account = await createIgAccount(owner.id);
    const [notification] = await db.insert(campaignNotificationOutbox).values({ igAccountId: account.id, userId: owner.id, key: "pause-test", kind: "account_paused", reason: "613", nextAttemptAt: CAMPAIGN_NOW }).returning();
    const failed = vi.fn(async () => { throw new Error("provider unavailable"); });
    expect(await sendCampaignNotifications(db, CAMPAIGN_NOW, failed)).toBe(0);
    const [waiting] = await db.select().from(campaignNotificationOutbox); expect(waiting.status).toBe("waiting");
    const send = vi.fn(async () => {});
    await Promise.all([sendCampaignNotifications(db, waiting.nextAttemptAt, send), sendCampaignNotifications(db, waiting.nextAttemptAt, send)]);
    expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0]).toMatchObject([{}, { idempotencyKey: `gonggu-notification/${notification.id}`, requireConfigured: true }]);
    expect((await db.select().from(campaignNotificationOutbox).where(eq(campaignNotificationOutbox.id, notification.id)))[0].status).toBe("sent");
  });
});
