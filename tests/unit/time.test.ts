import { describe, expect, it } from "vitest";
import { relativeTime } from "@/lib/time";

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
