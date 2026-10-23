import { describe, expect, it } from "vitest";
import { logTime, nextMonthStartKst, relativeTime } from "@/lib/time";

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

describe("logTime", () => {
  it("shows only the KST clock for the same KST day", () => {
    expect(logTime(new Date("2026-09-24T11:04:00Z"), now)).toEqual({ day: null, time: "20:04" });
  });
  it("adds the KST date for an earlier day, even when the UTC date is the same", () => {
    // 2026-09-23 23:30 KST = 2026-09-23T14:30Z — 지금(09-24 21:00 KST)과 KST 날짜가 다르다
    expect(logTime(new Date("2026-09-23T14:30:00Z"), now)).toEqual({ day: "9/23", time: "23:30" });
  });
  it("treats just after KST midnight as the new day", () => {
    const early = new Date("2026-09-24T15:10:00Z"); // 09-25 00:10 KST
    expect(logTime(new Date("2026-09-24T14:50:00Z"), early)).toEqual({ day: "9/24", time: "23:50" });
    expect(logTime(new Date("2026-09-24T15:01:00Z"), early)).toEqual({ day: null, time: "00:01" });
  });
});
