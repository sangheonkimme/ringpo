import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { automations, campaignMedia, campaigns, featureFlags, featureFlagOverrides, igAccounts, type NewCommentEvent } from "@/server/db/schema";
import type { ParsedComment } from "@/server/instagram/webhook";
import { CAMPAIGN_FLAG } from "@/server/campaigns/access";
import { effectiveCampaignState } from "@/server/campaigns/state";
import { enqueueComments } from "./events";

/** Only DB work here: Meta metadata reads and all sending happen in workers. */
export async function ingestComments(db: Db, comments: ParsedComment[], now: Date): Promise<number> {
  const candidates = comments.filter((c) => c.commenterIgId !== c.igUserId);
  if (candidates.length === 0) return 0;
  const igIds = [...new Set(candidates.map((c) => c.igUserId))];
  const [accounts, flags] = await Promise.all([
    db.select().from(igAccounts).where(and(inArray(igAccounts.igUserId, igIds), eq(igAccounts.status, "active"))),
    db.select().from(featureFlags).where(eq(featureFlags.key, CAMPAIGN_FLAG)),
  ]);
  if (!accounts.length) return 0;
  const accountIds = accounts.map((a) => a.id);
  const flag = flags[0];
  const [legacy, overrides] = await Promise.all([
    db.selectDistinct({ accountId: automations.igAccountId }).from(automations).where(and(inArray(automations.igAccountId, accountIds), eq(automations.isActive, true))),
    flag?.enabled ? db.select().from(featureFlagOverrides).where(and(eq(featureFlagOverrides.flagKey, CAMPAIGN_FLAG), inArray(featureFlagOverrides.igAccountId, accountIds))) : [],
  ]);
  const legacyIds = new Set(legacy.map((a) => a.accountId));
  const overrideMap = new Map(overrides.map((row) => [row.igAccountId, row.enabled]));
  const enabledIds = new Set(accounts.filter((a) => flag?.enabled && (overrideMap.get(a.id) ?? flag.defaultEnabled)).map((a) => a.id));
  const campaignRows = enabledIds.size ? await db.select({ campaign: campaigns, mediaId: campaignMedia.mediaId }).from(campaignMedia)
    .innerJoin(campaigns, eq(campaigns.id, campaignMedia.campaignId))
    .where(and(inArray(campaignMedia.igAccountId, [...enabledIds]), eq(campaignMedia.routingEnabled, true), inArray(campaignMedia.mediaId, [...new Set(candidates.map((c) => c.mediaId))]), isNull(campaigns.archivedAt), isNotNull(campaigns.publishedAt))) : [];
  const byMedia = new Map(campaignRows.map((row) => [`${row.campaign.igAccountId}:${row.mediaId}`, row.campaign]));
  const byIgId = new Map(accounts.map((a) => [a.igUserId, a]));
  const rows: NewCommentEvent[] = [];
  for (const c of candidates) {
    const account = byIgId.get(c.igUserId);
    if (!account) continue;
    const campaign = byMedia.get(`${account.id}:${c.mediaId}`);
    if (!campaign && !legacyIds.has(account.id)) continue;
    const enabled = enabledIds.has(account.id);
    rows.push({
      igAccountId: account.id, commentId: c.commentId, mediaId: c.mediaId,
      parentCommentId: c.parentCommentId, mediaProductType: c.mediaProductType,
      commenterIgId: c.commenterIgId, commenterUsername: c.commenterUsername,
      commentText: c.text, receivedAt: now, runAt: now,
      ...(enabled ? {
        status: "campaign_pending", routeOwner: "undecided", flagCheckedAt: now,
        campaignId: campaign?.id ?? null,
        stateAtReceipt: campaign ? effectiveCampaignState(campaign, now) : null,
        storedStateAtReceipt: campaign?.status ?? null,
        campaignVersionAtReceipt: campaign?.version ?? null,
        campaignRulesSnapshot: campaign ? { notificationKeywords: campaign.notificationKeywords, linkKeywords: campaign.linkKeywords, excludedKeywords: campaign.excludedKeywords, matchType: campaign.matchType } : null,
      } : {}),
    });
  }
  return enqueueComments(db, rows);
}
