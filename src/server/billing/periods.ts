const KST_OFFSET_MS = 9 * 3_600_000;

export function addMonthsKst(anchor: Date, months: number): Date {
  const k = new Date(anchor.getTime() + KST_OFFSET_MS);
  const day = k.getUTCDate();
  const first = new Date(
    Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + months, 1, k.getUTCHours(), k.getUTCMinutes(), k.getUTCSeconds(), k.getUTCMilliseconds()),
  );
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return new Date(first.getTime() - KST_OFFSET_MS);
}

/** anchor + n개월 중 `after`보다 뒤인 첫 시각 (n ≥ 1) */
export function nextPeriodEnd(anchor: Date, after: Date): Date {
  const ka = new Date(anchor.getTime() + KST_OFFSET_MS);
  const kb = new Date(after.getTime() + KST_OFFSET_MS);
  let n = Math.max(1, (kb.getUTCFullYear() - ka.getUTCFullYear()) * 12 + (kb.getUTCMonth() - ka.getUTCMonth()));
  let end = addMonthsKst(anchor, n);
  while (end.getTime() <= after.getTime()) end = addMonthsKst(anchor, ++n);
  return end;
}

export function kstDateStamp(d: Date): string {
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, "0")}${String(k.getUTCDate()).padStart(2, "0")}`;
}
