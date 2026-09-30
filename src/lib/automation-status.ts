export type StatusTone = "success" | "warning" | "danger" | "neutral";

export interface AutomationStatusInput {
  isActive: boolean;
  mediaScope: "specific" | "all" | "next";
  accountStatus: "active" | "reauth_required" | "disconnected";
}

/** 홈·목록·상세가 같은 이름과 색으로 보여 주는 자동화 실행 상태. 토글(isActive)과 어긋나지 않게 여기서만 정한다 */
export function automationStatus(a: AutomationStatusInput): { label: string; tone: StatusTone } {
  if (!a.isActive) return { label: "일시중지", tone: "neutral" };
  if (a.accountStatus !== "active") return { label: "확인 필요", tone: "danger" };
  // '다음 게시물' 자동화는 새 게시물이 올라오면 그 게시물에 묶이며 'specific'이 된다
  if (a.mediaScope === "next") return { label: "게시물 대기", tone: "success" };
  return { label: "실행 중", tone: "success" };
}

export const SCOPE_LABEL: Record<AutomationStatusInput["mediaScope"], string> = {
  specific: "특정 게시물",
  all: "모든 게시물",
  next: "다음 게시물",
};
