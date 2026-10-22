import { afterEach, describe, expect, it, vi } from "vitest";
import { clearReportPdfCache, getCachedReportPdf, putCachedReportPdf, reportPdfCacheGeneration } from "@/server/campaigns/report-pdf-cache";
describe("PDF memory lifetime", () => {
  afterEach(() => { clearReportPdfCache(); vi.useRealTimers(); });
  it("expires actual stored bytes without requiring another PDF request", () => {
    vi.useFakeTimers(); const key = "share:fixture"; putCachedReportPdf(key, Buffer.from("pdf"), reportPdfCacheGeneration()); expect(getCachedReportPdf(key)).toBeDefined();
    vi.advanceTimersByTime(60_000); expect(getCachedReportPdf(key)).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds bytes and timers and cannot cache an in-flight render begun before deletion", () => {
    vi.useFakeTimers(); const generation = reportPdfCacheGeneration(); for(let i=0;i<40;i++)putCachedReportPdf(String(i),Buffer.from("pdf"),generation);
    expect(getCachedReportPdf("0")).toBeUndefined(); expect(vi.getTimerCount()).toBe(32);
    clearReportPdfCache(); putCachedReportPdf("late",Buffer.from("pdf"),generation); expect(getCachedReportPdf("late")).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
  });
});
