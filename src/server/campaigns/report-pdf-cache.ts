/** Bounded process-local bytes only. Deletion prevents new caching; other processes expire bytes within 60s. */
const cache = new Map<string, { bytes: Buffer; expiresAt: number; timer: ReturnType<typeof setTimeout> }>();
let generation = 0;
export const reportPdfCacheGeneration = () => generation;
function remove(key: string) { const entry = cache.get(key); if (entry) clearTimeout(entry.timer); cache.delete(key); }
export function getCachedReportPdf(key: string) {
  const entry = cache.get(key); if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) { remove(key); return undefined; }
  return entry.bytes;
}
export function putCachedReportPdf(key: string, bytes: Buffer, expectedGeneration: number) {
  if (generation !== expectedGeneration) return;
  remove(key);
  if (cache.size >= 32) remove(cache.keys().next().value!);
  const entry = { bytes, expiresAt: Date.now() + 60_000, timer: setTimeout(() => { if (cache.get(key) === entry) remove(key); }, 60_000) };
  entry.timer.unref(); cache.set(key, entry);
}
export function clearReportPdfCache() {
  generation++;
  for (const key of cache.keys()) remove(key);
}
