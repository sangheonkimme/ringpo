export type StepState = "done" | "current" | "upcoming" | "locked";

export interface SetupInput {
  connected: boolean;
  professional: boolean;
  messageAccess: boolean;
  hasAutomation: boolean;
}

export function setupProgress(i: SetupInput) {
  // 프로페셔널 계정만 연결되므로, 연결됐다면 전환은 확인된 셈이다
  const professional = i.professional || i.connected;
  const ready = professional && i.messageAccess;
  const steps: [StepState, StepState, StepState] = [
    ready ? "done" : "current",
    i.connected ? "done" : ready ? "current" : "upcoming",
    !i.connected ? "locked" : i.hasAutomation ? "done" : "current",
  ];
  return { professional, ready, steps, doneCount: [ready, i.connected, i.hasAutomation].filter(Boolean).length };
}

/** 인스타 앱 안의 메뉴 경로. 앱 버전에 따라 이름이 조금 다를 수 있다 */
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
