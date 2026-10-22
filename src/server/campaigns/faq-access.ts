import { and, eq } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import { featureFlags, featureFlagOverrides } from "@/server/db/schema";

/** Operations enables this account only after real seller-echo validation; sellers cannot self-certify. */
export const FAQ_HANDOFF_FLAG = "gonggu_faq_handoff_verified";
export async function faqHandoffReady(db: Executor, accountId: string) {
  const [flag] = await db.select({ enabled: featureFlags.enabled, override: featureFlagOverrides.enabled }).from(featureFlags)
    .leftJoin(featureFlagOverrides, and(eq(featureFlagOverrides.flagKey, featureFlags.key), eq(featureFlagOverrides.igAccountId, accountId)))
    .where(eq(featureFlags.key, FAQ_HANDOFF_FLAG));
  return flag?.enabled === true && flag.override === true;
}
