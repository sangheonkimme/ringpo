export type StepState = "done" | "current" | "upcoming" | "locked";

export interface SetupInput {
  connected: boolean;
  messageAccess: boolean;
  hasAutomation: boolean;
}

/**
 * 시작하기 3단계: 인스타 연결 → 메시지 접근 허용 → 첫 자동화.
 * 개인 계정이면 인스타 공식 연결 창이 중간에 프로페셔널 전환을 직접 물어보므로 따로 안내하지 않는다.
 */
export function setupProgress(i: SetupInput) {
  const steps: [StepState, StepState, StepState] = [
    i.connected ? "done" : "current",
    i.messageAccess ? "done" : i.connected ? "current" : "upcoming",
    !i.connected ? "locked" : i.hasAutomation ? "done" : i.messageAccess ? "current" : "upcoming",
  ];
  return { steps, doneCount: [i.connected, i.messageAccess, i.hasAutomation].filter(Boolean).length };
}

/** 인스타 앱 안의 메뉴 경로. 앱 버전에 따라 이름이 조금 다를 수 있다. 프로페셔널 전환은 연결이 거절됐을 때만 안내한다 */
export const PROFESSIONAL_STEPS = [
  "프로필 → 오른쪽 위 ☰ 메뉴 → 설정 및 활동",
  "계정 유형 및 도구 → 프로페셔널 계정으로 전환",
  "크리에이터 또는 비즈니스 중 하나를 골라 완료",
];

export const MESSAGE_ACCESS_STEPS = [
  "프로필 → 오른쪽 위 ☰ 메뉴 → 설정 및 활동",
  "메시지 및 스토리 답장 → 메시지 제어",
  "연결된 도구 → ‘메시지 접근 허용’ 켜기",
];
