import type { CampaignState } from "@/lib/campaign-schema";

const NEXT: Record<CampaignState, readonly CampaignState[]> = {
  draft: ["teaser", "open"], teaser: ["open"], open: ["closed", "sold_out"],
  closed: ["settled"], sold_out: ["settled"], settled: [],
};

export function canTransitionCampaign(from: CampaignState, to: CampaignState): boolean {
  return NEXT[from].includes(to);
}

export function isActiveCampaign(campaign: { status: CampaignState; publishedAt: Date | null }): boolean {
  return campaign.status === "teaser" || campaign.status === "open" || (campaign.status === "draft" && campaign.publishedAt !== null);
}

export function dueCampaignTransitions(campaign: {
  status: CampaignState; publishedAt: Date | null; openAt: Date; closeAt: Date;
}, now: Date): CampaignState[] {
  if (!campaign.publishedAt) return [];
  const due: CampaignState[] = [];
  let state = campaign.status;
  if ((state === "draft" || state === "teaser") && campaign.openAt <= now) { due.push("open"); state = "open"; }
  if (state === "open" && campaign.closeAt <= now) due.push("closed");
  return due;
}
