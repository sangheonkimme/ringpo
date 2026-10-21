import { and, asc, eq, isNull } from "drizzle-orm";
import { buildTextFallback, truncateChars, truncateUtf8 } from "@/server/automations/render";
import { campaignMedia, campaignProducts } from "@/server/db/schema";
import type { Executor } from "@/server/db/client";
import type { PrivateReplyMessage } from "@/server/instagram/graph";
import type { RenderContext } from "./dispatch";
import { campaignPurchaseLink } from "./links";

export function renderCampaignTemplate(template: string, values: { productName: string; openAt: Date; mediaUrl: string; link: string }): string {
  const replacements: Record<string, string> = {
    상품명: values.productName,
    오픈일시: `${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(values.openAt)} (한국 시간)`,
    게시물링크: values.mediaUrl, 링크: values.link,
  };
  // One pass: a product name containing a placeholder is data, never another template.
  return template.replace(/\{(상품명|오픈일시|게시물링크|링크)\}/g, (_, name: string) => replacements[name]).trim();
}

export function campaignLinkMessage(template: string, values: Parameters<typeof renderCampaignTemplate>[1], format: "auto" | "text"): PrivateReplyMessage {
  const body = renderCampaignTemplate(template, { ...values, link: "" });
  if (format !== "text") return { kind: "button", text: truncateUtf8(truncateChars(body || values.productName, 640), 1000), buttonTitle: "상품 보러 가기", url: values.link };
  const inline = renderCampaignTemplate(template, values);
  return { kind: "text", text: template.includes("{링크}") && Buffer.byteLength(inline) <= 1000 ? inline : buildTextFallback(body, "상품 보러 가기", values.link) };
}

/** Called inside the preparation transaction. Every retry before a confirmed send sees the latest templates. */
export async function renderCampaignMessage(db: Executor, context: RenderContext, appUrl: string): Promise<PrivateReplyMessage | null> {
  const { campaign, job, event } = context;
  const [product] = await db.select({ name: campaignProducts.name }).from(campaignProducts).where(and(eq(campaignProducts.campaignId, campaign.id), isNull(campaignProducts.archivedAt))).orderBy(asc(campaignProducts.sortOrder), asc(campaignProducts.id)).limit(1);
  const [media] = event ? await db.select({ permalink: campaignMedia.permalink }).from(campaignMedia).where(and(eq(campaignMedia.campaignId, campaign.id), eq(campaignMedia.mediaId, event.mediaId))).limit(1) : [];
  const values = { productName: product?.name ?? campaign.title, openAt: campaign.openAt, mediaUrl: media?.permalink ?? "공구 게시물", link: "" };
  if (job.channel === "public_reply") {
    const stage = event?.stateAtReceipt === "teaser" ? "teaser" : event?.stateAtReceipt === "sold_out" ? "sold_out" : event?.stateAtReceipt === "closed" ? "closed" : "open";
    const templates = campaign.templates[stage].publicReplies;
    if (!templates.length) return null;
    return { kind: "text", text: truncateUtf8(renderCampaignTemplate(templates[job.publicTemplateIndex % templates.length], values), 1000) };
  }
  if (["follow_request", "follow_reminder"].includes(job.kind)) {
    // Private-reply quick-reply format and postback consent still require the two-account Meta check.
    // Until then use a genuine incoming user message to establish the messaging window.
    const prompt = "팔로우 후 ‘팔로우했어요’라고 답장해 주세요.";
    const text = renderCampaignTemplate(campaign.templates.follow, values);
    return { kind: "text", text: text.includes(prompt) && Buffer.byteLength(text) <= 1000 ? text : `${truncateUtf8(text.replaceAll(prompt, "").trim(), 1000 - Buffer.byteLength(`\n\n${prompt}`))}\n\n${prompt}` };
  }
  if (job.kind === "expiry_fallback") {
    const body = renderCampaignTemplate(campaign.templates.expiry, { ...values, mediaUrl: "" });
    const suffix = `\n\n오픈: ${renderCampaignTemplate("{오픈일시}", values)}\n${values.mediaUrl}`;
    return { kind: "text", text: `${truncateUtf8(body, 1000 - Buffer.byteLength(suffix))}${suffix}` };
  }
  if (job.kind === "closed_notice") return { kind: "text", text: truncateUtf8(renderCampaignTemplate(campaign.templates[campaign.status === "sold_out" ? "sold_out" : "closed"].privateReply, values), 1000) };
  if (!["opening_link", "instant_link", "follow_link"].includes(job.kind)) return null;
  const link = await campaignPurchaseLink(db, context, appUrl);
  if (!link) return null;
  return campaignLinkMessage(campaign.templates.open.privateReply, { ...values, productName: link.productName, link: link.url }, job.messageFormat);
}
