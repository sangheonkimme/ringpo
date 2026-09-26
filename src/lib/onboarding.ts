export type StepState = "done" | "current" | "upcoming" | "locked";

export interface SetupInput {
  connected: boolean;
  /** 최근 DM이 '메시지 접근 허용 꺼짐'으로 실패한 연결 계정이 있다 */
  dmBlocked: boolean;
  hasAutomation: boolean;
}

/**
 * 시작하기 3단계: 인스타 연결 → 메시지 접근 허용 → 첫 자동화.
 * 인스타 공식 연결 창이 프로페셔널 전환과 '메시지 액세스 허용'을 직접 처리하므로,
 * 메시지 접근은 연결되면 완료로 보고 실제로 DM이 막혔을 때만 다시 안내한다.
 */
export function setupProgress(i: SetupInput) {
  const messageOk = i.connected && !i.dmBlocked;
  const steps: [StepState, StepState, StepState] = [
    i.connected ? "done" : "current",
    !i.connected ? "upcoming" : messageOk ? "done" : "current",
    !i.connected ? "locked" : i.hasAutomation ? "done" : messageOk ? "current" : "upcoming",
  ];
  return { steps, doneCount: [i.connected, messageOk, i.hasAutomation].filter(Boolean).length };
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
