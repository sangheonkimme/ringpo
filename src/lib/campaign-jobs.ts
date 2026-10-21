export const CAMPAIGN_JOB_KINDS = ["public_reply", "opening_link", "instant_link", "follow_request", "follow_reminder", "follow_link", "closed_notice", "faq", "expiry_fallback"] as const;
export type CampaignJobKind = (typeof CAMPAIGN_JOB_KINDS)[number];
export const CAMPAIGN_JOB_STATES = ["waiting", "leased", "sending", "retry", "sent", "failed", "expired", "skipped_duplicate", "canceled", "held", "unknown"] as const;
export const SEND_CHANNELS = ["public_reply", "private_reply", "message"] as const;
export type SendChannel = (typeof SEND_CHANNELS)[number];

export function privateReplyDeadline(createdAt: Date, windowSeconds: number, safetySeconds: number) {
  if (windowSeconds <= safetySeconds || safetySeconds < 0) throw new Error("Invalid private reply safety window");
  const hardExpiresAt = new Date(createdAt.getTime() + windowSeconds * 1000);
  return { deadlineAt: new Date(hardExpiresAt.getTime() - safetySeconds * 1000), hardExpiresAt };
}

export function compareCampaignJobs(a: { id: string; deadlineAt: Date; commentCreatedAt: Date }, b: { id: string; deadlineAt: Date; commentCreatedAt: Date }) {
  return a.deadlineAt.getTime() - b.deadlineAt.getTime() || a.commentCreatedAt.getTime() - b.commentCreatedAt.getTime() || a.id.localeCompare(b.id);
}
