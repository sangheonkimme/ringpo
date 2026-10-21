import { and, eq } from "drizzle-orm";
import { getUserPlan } from "@/server/billing/plan-of";
import type { Executor } from "@/server/db/client";
import { campaignPolicies, featureFlags, featureFlagOverrides, igAccounts, planEntitlements } from "@/server/db/schema";

export const CAMPAIGN_FLAG = "gonggu_campaigns";

export class CampaignError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "CampaignError"; }
}

export async function campaignsEnabled(db: Executor, igAccountId: string): Promise<boolean> {
  const [flag] = await db.select().from(featureFlags).where(eq(featureFlags.key, CAMPAIGN_FLAG));
  if (!flag?.enabled) return false;
  const [override] = await db.select().from(featureFlagOverrides).where(and(eq(featureFlagOverrides.flagKey, CAMPAIGN_FLAG), eq(featureFlagOverrides.igAccountId, igAccountId)));
  return override?.enabled ?? flag.defaultEnabled;
}

export async function campaignAccounts(db: Executor, userId: string) {
  const accounts = await db.select().from(igAccounts).where(and(eq(igAccounts.userId, userId), eq(igAccounts.status, "active")));
  const enabled = await Promise.all(accounts.map((account) => campaignsEnabled(db, account.id)));
  return accounts.filter((_, index) => enabled[index]);
}

export async function requireCampaignAccount(db: Executor, userId: string, id: string) {
  const [account] = await db.select().from(igAccounts).where(and(eq(igAccounts.id, id), eq(igAccounts.userId, userId)));
  if (!account) throw new CampaignError("not_found", "인스타 계정을 찾을 수 없어요");
  if (!await campaignsEnabled(db, account.id)) throw new CampaignError("disabled", "아직 공구 기능을 사용할 수 없어요");
  if (account.status !== "active" || !account.accessTokenEnc) throw new CampaignError("account_inactive", "인스타 계정을 다시 연결해주세요");
  return account;
}

export async function campaignEntitlements(db: Executor, userId: string) {
  const plan = await getUserPlan(db, userId);
  const rows = await db.select().from(planEntitlements).where(eq(planEntitlements.plan, plan.id));
  return new Map(rows.map((row) => [row.key, row]));
}

export async function requireCampaignFeature(db: Executor, userId: string, key: string) {
  const entitlement = (await campaignEntitlements(db, userId)).get(key);
  if (entitlement?.kind !== "boolean" || entitlement.booleanValue !== true) throw new CampaignError("entitlement", "현재 요금제에서 사용할 수 없는 공구 기능이에요");
}

export async function campaignPolicy(db: Executor, key: string): Promise<number> {
  const [row] = await db.select().from(campaignPolicies).where(eq(campaignPolicies.key, key));
  if (!row) throw new CampaignError("configuration", "공구 설정을 확인해야 해요. 잠시 후 다시 시도해주세요");
  return row.value;
}
