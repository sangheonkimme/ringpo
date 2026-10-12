export const MAX_ATTEMPTS = 5;

/** 30초 × 2^(attempt-1), ±20% 지터 */
export function backoffDelayMs(attempt: number, random: () => number): number {
  const base = 30_000 * 2 ** Math.max(0, attempt - 1);
  const jitter = 0.8 + random() * 0.4;
  return Math.round(base * jitter);
}
