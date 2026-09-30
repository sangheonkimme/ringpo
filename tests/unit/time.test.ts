import { describe, expect, it } from "vitest";
import { nextMonthStartKst, relativeTime } from "@/lib/time";

const now = new Date("2026-09-24T12:00:00Z"); // 21:00 KST

describe("relativeTime", () => {
  it("uses minutes and hours for recent times", () => {
    expect(relativeTime(new Date(now.getTime() - 20_000), now)).toBe("방금");
    expect(relativeTime(new Date(now.getTime() - 5 * 60_000), now)).toBe("5분 전");
    expect(relativeTime(new Date(now.getTime() - 3 * 3_600_000), now)).toBe("3시간 전");
  });
  it("falls back to a KST date for older times", () => {
    expect(relativeTime(new Date("2026-09-20T06:05:00Z"), now)).toBe("9월 20일 15:05");
  });
});

describe("nextMonthStartKst", () => {
  it("names the first day of the next KST month", () => {
    expect(nextMonthStartKst(now)).toBe("10월 1일");
  });
  it("uses the KST month, not the UTC month", () => {
    // 2026-12-31 16:00 UTC = 2027-01-01 01:00 KST
    expect(nextMonthStartKst(new Date("2026-12-31T16:00:00Z"))).toBe("2월 1일");
    expect(nextMonthStartKst(new Date("2026-12-31T14:00:00Z"))).toBe("1월 1일");
  });
});
