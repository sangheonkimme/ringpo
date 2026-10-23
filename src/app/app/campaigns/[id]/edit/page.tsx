import { notFound } from "next/navigation";
import { z } from "zod";
import { CampaignForm } from "@/components/app/campaign-form";
import { campaignAccounts, campaignEntitlements } from "@/server/campaigns/access";
import { getCampaign } from "@/server/campaigns/service";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";

export const metadata = { title: "공구 수정" };

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(); const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb(); const campaign = await getCampaign(db, user.id, id);
  if (!campaign || campaign.status === "settled") notFound();
  const [accounts, entitlements] = await Promise.all([campaignAccounts(db, user.id), campaignEntitlements(db, user.id)]);
  return <main className="flex flex-col gap-6 px-5 pb-28 pt-5"><h1 className="font-display text-[28px] leading-[1.3] tracking-[-0.02em]">공구 수정</h1><CampaignForm id={id} version={campaign.version} accounts={accounts.map((a) => ({ id: a.id, username: a.username }))} defaultRate={campaign.hourlyRate} nowIso={new Date().toISOString()} features={{ followGate: entitlements.get("campaign.follow_gate")?.booleanValue === true, scheduledDm: entitlements.get("campaign.scheduled_dm")?.booleanValue === true }} initial={{
    igAccountId: campaign.igAccountId, title: campaign.title, brand: campaign.brand,
    notificationKeywords: campaign.notificationKeywords, linkKeywords: campaign.linkKeywords, excludedKeywords: campaign.excludedKeywords,
    matchType: campaign.matchType, templates: campaign.templates, followOnly: campaign.followOnly,
    followFailurePolicy: campaign.followFailurePolicy, expiryFallbackEnabled: campaign.expiryFallbackEnabled, hourlyRate: campaign.hourlyRate,
    openAt: campaign.openAt.toISOString(), closeAt: campaign.closeAt.toISOString(),
    products: campaign.products.map((p) => ({ id: p.id, name: p.name, option: p.option, url: p.originalUrl })),
    media: campaign.media.map((m) => ({ id: m.mediaId, permalink: m.permalink, thumbnailUrl: null, caption: null })),
  }} /></main>;
}
