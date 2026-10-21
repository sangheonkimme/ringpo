export interface GraphRateHint { retryAfterMs?: number; usagePercent?: number }

export function graphRateHint(headers: Headers, nowMs = Date.now()): GraphRateHint | undefined {
  let retryAfterMs = 0; let usagePercent = 0;
  const validWait = (ms: number) => Number.isFinite(ms) && ms >= 0 && !Number.isNaN(new Date(nowMs + ms).getTime());
  const retry = headers.get("retry-after");
  if (retry) {
    const seconds = Number(retry);
    const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - nowMs;
    if (validWait(wait)) retryAfterMs = Math.max(0, wait);
  }
  for (const name of ["x-business-use-case-usage", "x-app-usage"]) {
    const raw = headers.get(name);
    if (!raw || raw.length > 16_384) continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const entries = name === "x-app-usage" ? [parsed] : Object.values(parsed).flat().filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object");
      for (const value of entries) {
        for (const key of ["call_count", "total_cputime", "total_time"]) if (typeof value[key] === "number" && Number.isFinite(value[key])) usagePercent = Math.max(usagePercent, value[key]);
        const minutes = value.estimated_time_to_regain_access;
        if (typeof minutes === "number" && validWait(minutes * 60_000)) retryAfterMs = Math.max(retryAfterMs, minutes * 60_000);
      }
    } catch { /* Invalid provider header is not permission to bypass our local limiter. */ }
  }
  return retryAfterMs > 0 || usagePercent > 0 ? { ...(retryAfterMs > 0 ? { retryAfterMs } : {}), ...(usagePercent > 0 ? { usagePercent } : {}) } : undefined;
}
