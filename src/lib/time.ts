const KST_OFFSET_MS = 9 * 3_600_000;

export function relativeTime(date: Date, now: Date = new Date()): string {
  const diff = now.getTime() - date.getTime();
  if (diff < 60_000) return "방금";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  const k = new Date(date.getTime() + KST_OFFSET_MS);
  const hh = String(k.getUTCHours()).padStart(2, "0");
  const mm = String(k.getUTCMinutes()).padStart(2, "0");
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 ${hh}:${mm}`;
}

/**
 * 발송 기록(로그)의 시각 칸. 같은 날(KST)이면 "21:04", 아니면 날짜를 위 줄에 붙인다 — { day: "10/21", time: "14:03" }.
 * 시간순으로 훑어보는 목록이라 "5분 전"보다 시각이 낫다(디자인 A + C 의 로그 표시, 2026-10-23)
 */
export function logTime(date: Date, now: Date = new Date()): { day: string | null; time: string } {
  const k = new Date(date.getTime() + KST_OFFSET_MS);
  const n = new Date(now.getTime() + KST_OFFSET_MS);
  const time = `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
  const sameDay = k.getUTCFullYear() === n.getUTCFullYear() && k.getUTCMonth() === n.getUTCMonth() && k.getUTCDate() === n.getUTCDate();
  return { day: sameDay ? null : `${k.getUTCMonth() + 1}/${k.getUTCDate()}`, time };
}

export function kstDate(date: Date): string {
  const k = new Date(date.getTime() + KST_OFFSET_MS);
  return `${k.getUTCFullYear()}년 ${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일`;
}

/** 월 사용량이 초기화되는 날(다음 달 1일, KST) */
export function nextMonthStartKst(now: Date): string {
  const k = new Date(now.getTime() + KST_OFFSET_MS);
  return `${((k.getUTCMonth() + 1) % 12) + 1}월 1일`;
}
