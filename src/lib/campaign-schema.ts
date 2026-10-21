import { z } from "zod";
import { normalizeCampaignText } from "@/server/automations/matcher";

export const CAMPAIGN_STATES = ["draft", "teaser", "open", "closed", "sold_out", "settled"] as const;
export type CampaignState = (typeof CAMPAIGN_STATES)[number];
export const CAMPAIGN_STATE_LABELS: Record<CampaignState, string> = {
  draft: "초안", teaser: "예고", open: "진행 중", closed: "마감", sold_out: "품절", settled: "정산 완료",
};

const keyword = z.string().trim().min(1).max(100).refine((value) => normalizeCampaignText(value).length > 0, "키워드에 문자나 숫자를 입력해주세요");
const message = z.string().trim().min(1).max(600);
const templateSchema = z.object({
  publicReplies: z.array(message).max(10),
  privateReply: message,
});
export const campaignTemplatesSchema = z.object({
  teaser: templateSchema,
  open: templateSchema,
  closed: templateSchema,
  sold_out: templateSchema,
  follow: message,
  expiry: message,
});
export type CampaignTemplates = z.infer<typeof campaignTemplatesSchema>;

export const DEFAULT_CAMPAIGN_TEMPLATES: CampaignTemplates = {
  teaser: { publicReplies: ["알림 신청 완료! 공구가 열리면 DM으로 알려드릴게요."], privateReply: "{상품명} 공구가 열렸어요! {링크}" },
  open: { publicReplies: ["구매 링크를 DM으로 보내드릴게요.", "DM에서 공구 링크를 확인해 주세요."], privateReply: "{상품명} 공구 구매 링크예요. {링크}" },
  closed: { publicReplies: [], privateReply: "이번 {상품명} 공구는 마감됐어요. 관심 가져주셔서 감사합니다." },
  sold_out: { publicReplies: [], privateReply: "{상품명}이 품절됐어요. 관심 가져주셔서 감사합니다." },
  follow: "팔로우 후 ‘팔로우했어요’라고 답장해 주세요. 확인 후 구매 링크를 보내드릴게요.",
  expiry: "신청하신 {상품명} 공구는 {오픈일시}에 열려요. 일정은 {게시물링크}에서 확인해 주세요.",
};

const productSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "상품명을 입력해주세요").max(100),
  option: z.string().trim().max(100).default(""),
  url: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "상품 링크는 로그인 정보가 없는 https 주소여야 해요"),
});

export const campaignInputSchema = z.object({
  igAccountId: z.uuid(),
  title: z.string().trim().min(1, "공구 제목을 입력해주세요").max(100),
  brand: z.string().trim().max(100).default(""),
  openAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  closeAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  notificationKeywords: z.array(keyword).max(30).default(["알림"]),
  linkKeywords: z.array(keyword).min(1).max(30),
  excludedKeywords: z.array(keyword).max(30).default([]),
  matchType: z.enum(["contains", "exact"]).default("contains"),
  templates: campaignTemplatesSchema.default(DEFAULT_CAMPAIGN_TEMPLATES),
  followOnly: z.boolean().default(false),
  followFailurePolicy: z.enum(["send_link", "hold"]).default("send_link"),
  expiryFallbackEnabled: z.boolean().default(false),
  hourlyRate: z.number().int().min(1).max(750).optional(),
  products: z.array(productSchema).min(1, "상품을 하나 이상 추가해주세요").max(20),
  mediaIds: z.array(z.string().regex(/^\d+$/, "게시물 ID를 확인해주세요").max(100)).min(1).max(20),
}).superRefine((value, ctx) => {
  if (value.openAt >= value.closeAt) ctx.addIssue({ code: "custom", path: ["closeAt"], message: "마감 시각은 오픈 이후여야 해요" });
  if (new Set(value.mediaIds).size !== value.mediaIds.length) ctx.addIssue({ code: "custom", path: ["mediaIds"], message: "같은 게시물을 중복 선택할 수 없어요" });
  const ids = value.products.flatMap((p) => p.id ? [p.id] : []);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["products"], message: "같은 상품을 중복 추가할 수 없어요" });
});

export type CampaignInput = z.output<typeof campaignInputSchema>;

/** datetime-local values in the seller UI are always Asia/Seoul, independent of the browser's zone. */
export function campaignUtcFromKst(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("날짜와 시간을 확인해주세요");
  const date = new Date(`${value}:00+09:00`);
  if (Number.isNaN(date.getTime()) || campaignKstInput(date) !== value) throw new Error("날짜와 시간을 확인해주세요");
  return date.toISOString();
}

export function campaignKstInput(date: Date): string {
  return new Date(date.getTime() + 9 * 3_600_000).toISOString().slice(0, 16);
}
