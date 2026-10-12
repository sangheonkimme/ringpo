import type { EventStatus, SkipReason } from "@/server/db/schema";

export const STATUS_LABEL: Record<EventStatus, string> = {
  pending: "대기",
  processing: "처리 중",
  succeeded: "발송 완료",
  partial: "일부 발송",
  failed: "실패",
  skipped: "건너뜀",
  expired: "기한 만료",
  awaiting_follow: "팔로우 대기",
};

export const SKIP_LABEL: Record<SkipReason, string> = {
  self: "본인 댓글",
  no_match: "키워드 불일치",
  duplicate: "이 게시물에서 이미 보낸 사람",
  quota: "월 DM 한도 초과",
  account_inactive: "인스타 연결 끊김",
  automation_inactive: "자동화 꺼짐",
};

export const TOGGLE_ERROR: Record<"not_found" | "limit" | "account_inactive", string> = {
  not_found: "자동화를 찾을 수 없어요",
  limit: "현재 플랜에서 켤 수 있는 자동화 수를 넘었어요. 플랜을 업그레이드하거나 다른 자동화를 꺼주세요",
  account_inactive: "인스타 계정 연결을 먼저 확인해주세요",
};

export function keywordSummary(keywords: string[], matchType: "contains" | "exact" | "any"): string {
  if (matchType === "any") return "모든 댓글";
  const list = keywords.join(", ");
  return matchType === "exact" ? `${list} (정확히 일치)` : list;
}
