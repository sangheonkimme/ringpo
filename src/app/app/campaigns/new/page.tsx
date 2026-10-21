import { notFound } from "next/navigation";
import { CampaignForm } from "@/components/app/campaign-form";
import { campaignAccounts, campaignEntitlements, campaignPolicy } from "@/server/campaigns/access";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";

export const metadata = { title: "새 공구" };

export default async function NewCampaignPage() {
  const user = await requireUser(); const db = getDb();
  const accounts = await campaignAccounts(db, user.id);
  if (accounts.length === 0) notFound();
  const [entitlements, rate] = await Promise.all([campaignEntitlements(db, user.id), campaignPolicy(db, "private_reply_default_rate")]);
  return <main className="flex flex-col gap-6 px-5 pb-28 pt-5"><h1 className="text-2xl font-extrabold">새 공구 만들기</h1><CampaignForm accounts={accounts.map((a) => ({ id: a.id, username: a.username }))} defaultRate={rate} nowIso={new Date().toISOString()} features={{ followGate: entitlements.get("campaign.follow_gate")?.booleanValue === true, scheduledDm: entitlements.get("campaign.scheduled_dm")?.booleanValue === true }} /></main>;
}
