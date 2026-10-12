export type PlanId = "free" | "pro" | "agency";

export interface Plan {
  id: PlanId;
  name: string;
  priceKrw: number;
  maxIgAccounts: number;
  maxActiveAutomations: number | null;
  monthlyDmLimit: number;
  linkTracking: boolean;
  branding: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", name: "Free", priceKrw: 0, maxIgAccounts: 1, maxActiveAutomations: 3, monthlyDmLimit: 1000, linkTracking: false, branding: true },
  pro: { id: "pro", name: "Pro", priceKrw: 9900, maxIgAccounts: 1, maxActiveAutomations: null, monthlyDmLimit: 10_000, linkTracking: true, branding: false },
  agency: { id: "agency", name: "Agency", priceKrw: 59000, maxIgAccounts: 5, maxActiveAutomations: null, monthlyDmLimit: 50_000, linkTracking: true, branding: false },
};

export const PAID_PLAN_IDS = ["pro", "agency"] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

/** 새로 가입할 수 있는 유료 플랜. Agency는 판매를 멈췄고, 이미 구독 중인 경우(카드 변경 포함)만 유지한다 */
export const OFFERED_PAID_PLAN_IDS = ["pro"] as const;

export function canSubscribe(target: PaidPlanId, current: PlanId): boolean {
  return (OFFERED_PAID_PLAN_IDS as readonly PlanId[]).includes(target) || target === current;
}

export function isUpgrade(from: PlanId, to: PlanId): boolean {
  return PLANS[to].priceKrw > PLANS[from].priceKrw;
}

export function formatKrw(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}
