import { describe, expect, it } from "vitest";
import { generateCode, isBotUserAgent } from "@/server/links";
import { backoffDelayMs } from "@/server/queue/backoff";

describe("backoffDelayMs", () => {
  it("doubles from 30s with ±20% jitter", () => {
    expect(backoffDelayMs(1, () => 0.5)).toBe(30_000);
    expect(backoffDelayMs(3, () => 0.5)).toBe(120_000);
    expect(backoffDelayMs(1, () => 0)).toBe(24_000);
    expect(backoffDelayMs(1, () => 1)).toBe(36_000);
  });
});

describe("links helpers", () => {
  it("generates base62 codes", () => {
    expect(generateCode()).toMatch(/^[0-9A-Za-z]{7}$/);
    expect(new Set(Array.from({ length: 200 }, () => generateCode())).size).toBe(200);
  });
  it("detects link-preview bots", () => {
    expect(isBotUserAgent("facebookexternalhit/1.1")).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (iPhone) Instagram 350.0.0.0")).toBe(false);
    expect(isBotUserAgent("Mozilla/5.0 (Linux; Android 14) KAKAOTALK 10.0")).toBe(false);
  });
});
