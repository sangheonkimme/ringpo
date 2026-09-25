import { z } from "zod";

export const KEYWORD_MAX = 30;
export const REPLY_MAX = 300;
export const DM_TEXT_MAX = 600;
export const BUTTON_TITLE_MAX = 20;

/** 새 자동화에 미리 채워 두는 문구. 빈칸 대신 바로 보낼 수 있는 문장을 넣고 사용자가 고쳐 쓴다 */
export const DEFAULT_REPLY_TEXTS = ["{username} DM 확인해주세요! 📩", "{username} DM으로 링크 보내드렸어요 💌", "{username} 메시지함을 확인해주세요 ✨"];
export const DEFAULT_DM_TEXT = "댓글 남겨주셔서 고마워요! 요청하신 링크를 보내드려요. 아래 버튼을 눌러 확인해 주세요.";
export const DEFAULT_BUTTON_TITLE = "링크 열기";
export const FOLLOW_GATE_TEXT_MAX = 300;
export const DEFAULT_FOLLOW_GATE_TEXT = "댓글 고마워요! 팔로우한 분께 링크를 보내드려요 😊\n팔로우하고 아래 [팔로우했어요] 버튼을 눌러 주세요.";

const URL_IN_TEXT = /(https?:\/\/|www\.)\S+/i;

const replyText = z
  .string()
  .trim()
  .min(1, "빈 답글 문구가 있어요")
  .max(REPLY_MAX, `답글은 ${REPLY_MAX}자까지 쓸 수 있어요`)
  .refine((t) => !URL_IN_TEXT.test(t), "공개 답글에는 링크를 넣을 수 없어요")
  .refine((t) => (t.match(/#[^\s#]+/g) ?? []).length <= 4, "해시태그는 4개까지 넣을 수 있어요");

export const automationInputSchema = z
  .object({
    igAccountId: z.uuid({ error: "인스타 계정을 선택해주세요" }),
    name: z.string().trim().min(1, "이름을 입력해주세요").max(50, "이름은 50자까지 쓸 수 있어요"),
    mediaScope: z.enum(["specific", "all", "next"]),
    media: z
      .object({
        id: z.string().min(1),
        thumbnailUrl: z.string().nullable(),
        permalink: z.string().nullable(),
        caption: z.string().nullable(),
      })
      .nullable(),
    keywords: z
      .array(z.string().trim().min(1).max(KEYWORD_MAX, `키워드는 ${KEYWORD_MAX}자까지 쓸 수 있어요`))
      .max(10, "키워드는 10개까지 넣을 수 있어요"),
    matchType: z.enum(["contains", "exact", "any"]),
    replyEnabled: z.boolean(),
    replyTexts: z.array(replyText).max(5, "답글 문구는 5개까지 넣을 수 있어요"),
    dmText: z.string().trim().min(1, "DM 내용을 입력해주세요").max(DM_TEXT_MAX, `DM은 ${DM_TEXT_MAX}자까지 쓸 수 있어요`),
    dmButtonTitle: z
      .string()
      .trim()
      .min(1, "버튼 문구를 입력해주세요")
      .max(BUTTON_TITLE_MAX, `버튼 문구는 ${BUTTON_TITLE_MAX}자까지 쓸 수 있어요`),
    dmLinkUrl: z.url({ protocol: /^https$/, error: "https:// 로 시작하는 링크를 입력해주세요" }),
  })
  .superRefine((v, ctx) => {
    if (v.mediaScope === "specific" && !v.media) {
      ctx.addIssue({ code: "custom", path: ["media"], message: "게시물을 선택해주세요" });
    }
    if (v.replyEnabled && v.replyTexts.length === 0) {
      ctx.addIssue({ code: "custom", path: ["replyTexts"], message: "답글 문구를 1개 이상 입력해주세요" });
    }
    if (v.matchType !== "any" && v.keywords.length === 0) {
      ctx.addIssue({ code: "custom", path: ["keywords"], message: "키워드를 1개 이상 입력해주세요" });
    }
  });

export type AutomationInput = z.infer<typeof automationInputSchema>;
