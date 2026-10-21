import { createHash, randomUUID } from "node:crypto";
import { DEFAULT_CAMPAIGN_TEMPLATES } from "@/lib/campaign-schema";
import { encryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { campaignDeliveries, campaignParticipants, campaigns, commentEvents, dmJobs, igAccounts, privateReplyClaims, user } from "@/server/db/schema";

/** Seed a dispatch-only benchmark; webhook/routing load has a separate end-to-end test. */
export async function seedDispatchLoad(accounts: number, count: number, now: Date, rate = 400, includePublic = false) {
  const db = getDb();
  const owners = Array.from({ length: accounts }, (_, i) => ({ id: randomUUID(), name: "발송 부하 테스트", email: `send-${i}@test.local` }));
  await db.insert(user).values(owners);
  const accountRows = owners.map((owner, i) => ({ id: randomUUID(), userId: owner.id, igUserId: `1784${i}`, username: `fixture${i}`, accountType: "BUSINESS", accessTokenEnc: encryptSecret("fixture-only") }));
  await db.insert(igAccounts).values(accountRows);
  const campaignRows = accountRows.map((account) => ({ id: randomUUID(), userId: account.userId, igAccountId: account.id, title: "발송 부하", slug: randomUUID(), status: "open" as const, publishedAt: now, openAt: now, closeAt: new Date(now.getTime() + 2 * 86_400_000), notificationKeywords: ["알림"], linkKeywords: ["링크"], templates: DEFAULT_CAMPAIGN_TEMPLATES, hourlyRate: rate }));
  await db.insert(campaigns).values(campaignRows);
  const jobIds: string[] = [];
  for (let offset = 0; offset < count; offset += 100) {
    const rows = Array.from({ length: Math.min(count - offset, 100) }, (_, j) => {
      const i = offset + j; const campaign = campaignRows[i % accounts]; const eventId = randomUUID(); const participantId = randomUUID(); const jobId = randomUUID(); const commentId = `load-comment-${i}`;
      const createdAt = new Date(now.getTime() - i * 1000);
      return { i, campaign, eventId, participantId, jobId, commentId, createdAt };
    });
    await db.insert(commentEvents).values(rows.map((r) => ({ id: r.eventId, igAccountId: r.campaign.igAccountId, campaignId: r.campaign.id, commentId: r.commentId, commenterIgId: `person-${r.i}`, mediaId: "load-media", commentCreatedAt: r.createdAt, routeOwner: "campaign" as const, status: "campaign_routed" as const })));
    await db.insert(campaignParticipants).values(rows.map((r) => ({ id: r.participantId, campaignId: r.campaign.id, igAccountId: r.campaign.igAccountId, commenterIgId: `person-${r.i}`, recipientHash: createHash("sha256").update(`fixture-${r.i}`).digest("hex"), firstEventId: r.eventId, firstCommentCreatedAt: r.createdAt })));
    await db.insert(dmJobs).values(rows.map((r) => ({ id: r.jobId, campaignId: r.campaign.id, igAccountId: r.campaign.igAccountId, participantId: r.participantId, sourceEventId: r.eventId, channel: "private_reply" as const, kind: "opening_link" as const, scheduledAt: now, nextAttemptAt: now, deadlineAt: new Date(r.createdAt.getTime() + 7 * 86_400_000 - 3_600_000), hardExpiresAt: new Date(r.createdAt.getTime() + 7 * 86_400_000), commentCreatedAt: r.createdAt, idempotencyKey: `dispatch-load:${r.jobId}` })));
    await db.insert(privateReplyClaims).values(rows.map((r) => ({ commentId: r.commentId, jobId: r.jobId })));
    await db.insert(campaignDeliveries).values(rows.flatMap((r) => ([{ participantId: r.participantId, intent: "initial_contact" as const, owningJobId: r.jobId }, { participantId: r.participantId, intent: "link" as const, owningJobId: r.jobId }])));
    jobIds.push(...rows.map((r) => r.jobId));
    if (includePublic) {
      const replies = rows.map((r) => ({ ...r, publicJobId: randomUUID() }));
      await db.insert(dmJobs).values(replies.map((r) => ({ id: r.publicJobId, campaignId: r.campaign.id, igAccountId: r.campaign.igAccountId, participantId: r.participantId, sourceEventId: r.eventId, channel: "public_reply" as const, kind: "public_reply" as const, scheduledAt: now, nextAttemptAt: now, deadlineAt: new Date(r.createdAt.getTime() + 7 * 86_400_000 - 3_600_000), hardExpiresAt: new Date(r.createdAt.getTime() + 7 * 86_400_000), commentCreatedAt: r.createdAt, idempotencyKey: `dispatch-load:${r.publicJobId}` })));
      await db.insert(campaignDeliveries).values(replies.map((r) => ({ participantId: r.participantId, intent: "public_ack" as const, owningJobId: r.publicJobId })));
      jobIds.push(...replies.map((r) => r.publicJobId));
    }
  }
  return { jobIds, accounts: accountRows };
}
