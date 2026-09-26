import { describe, expect, it } from "vitest";
import { addMonthsKst, kstDateStamp, nextPeriodEnd } from "@/server/billing/periods";

// 2026-01-31 01:00 KST = 2026-01-30T16:00:00Z
const anchor = new Date("2026-01-30T16:00:00Z");

describe("KST billing periods", () => {
  it("clamps to the last day of shorter months", () => {
    expect(addMonthsKst(anchor, 1).toISOString()).toBe("2026-02-27T16:00:00.000Z"); // 2/28 01:00 KST
    expect(addMonthsKst(anchor, 2).toISOString()).toBe("2026-03-30T16:00:00.000Z"); // 3/31 01:00 KST
  });
  it("does not drift after a short month", () => {
    const feb = nextPeriodEnd(anchor, anchor);
    expect(feb.toISOString()).toBe("2026-02-27T16:00:00.000Z");
    expect(nextPeriodEnd(anchor, feb).toISOString()).toBe("2026-03-30T16:00:00.000Z");
  });
  it("skips forward past a late renewal", () => {
    expect(nextPeriodEnd(anchor, new Date("2026-04-15T00:00:00Z")).toISOString()).toBe("2026-04-29T16:00:00.000Z");
  });
  it("stamps dates in KST", () => {
    expect(kstDateStamp(new Date("2026-09-30T15:30:00Z"))).toBe("20261001");
  });
});
