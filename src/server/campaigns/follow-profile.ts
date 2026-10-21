import { and, eq } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { campaignNotificationOutbox, conversationStates, igAccounts, type IgAccount } from "@/server/db/schema";
import { classifyError, GraphApiError, GraphNetworkError } from "@/server/instagram/errors";
import type { GraphClient } from "@/server/instagram/graph";
import { legacyReadPause } from "./legacy-guard";
import { observeRateHint } from "./send-budget";

export type FollowDecision = { kind: "following" | "not_following" | "no_consent" | "unknown" | "fail_open" | "blocked"; code: string } |
  { kind: "retry"; code: string; nextAt: Date };

/** A comment or a postback alone never authorizes this read. Missing permission is distinct from an outage. */
export async function checkCampaignFollower(deps: { db: Db; graph: GraphClient; decryptToken: (value: string) => string; now: () => Date }, account: IgAccount, peerId: string, failurePolicy: "send_link" | "hold"): Promise<FollowDecision> {
  const now = deps.now();
  if (account.status !== "active" || !account.accessTokenEnc) return { kind: "blocked", code: "account_inactive" };
  const [conversation] = await deps.db.select().from(conversationStates).where(and(eq(conversationStates.igAccountId, account.id), eq(conversationStates.senderId, peerId)));
  if (!conversation?.consentAt || conversation.consentAt > now) return { kind: "no_consent", code: "profile_consent_missing" };
  const pause = await legacyReadPause(deps.db, account.id, now);
  if (pause) return { kind: "retry", code: "api_cooldown", nextAt: pause };
  // Decryption/configuration failures are never evidence that a follower check should fail open.
  const token = deps.decryptToken(account.accessTokenEnc);
  try {
    const profile = await deps.graph.getFollowerProfile(token, peerId);
    await observeRateHint(deps.db, account.id, profile.rateHint, deps.now());
    return { kind: profile.following === true ? "following" : profile.following === false ? "not_following" : "unknown", code: profile.following === null ? "profile_field_missing" : "profile_checked" };
  } catch (error) {
    const classified = classifyError(error);
    if (classified.cls === "auth") {
      await deps.db.transaction(async (tx) => {
        const [changed] = await tx.update(igAccounts).set({ status: "reauth_required" }).where(and(eq(igAccounts.id, account.id), eq(igAccounts.status, "active"))).returning();
        if (changed) await tx.insert(campaignNotificationOutbox).values({ igAccountId: account.id, userId: account.userId, key: `profile-auth:${account.id}:${now.toISOString()}`, kind: "reauth_required", reason: classified.code, nextAttemptAt: now }).onConflictDoNothing();
      });
      return { kind: "blocked", code: classified.code };
    }
    const retryMs = error instanceof GraphApiError ? error.retryAfterMs ?? 0 : 0;
    if (classified.cls === "rate_limited" || retryMs) {
      const delay = Math.max(retryMs, 60_000);
      await observeRateHint(deps.db, account.id, { retryAfterMs: delay }, deps.now());
      return { kind: "retry", code: classified.code, nextAt: new Date(deps.now().getTime() + delay) };
    }
    const outage = error instanceof GraphNetworkError || (error instanceof GraphApiError && (error.httpStatus >= 500 || error.code === 1 || error.code === 2));
    if (outage) return failurePolicy === "send_link" ? { kind: "fail_open", code: classified.code } : { kind: "retry", code: classified.code, nextAt: new Date(deps.now().getTime() + 30_000) };
    return { kind: "blocked", code: classified.code };
  }
}
