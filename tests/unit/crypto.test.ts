import { describe, expect, it } from "vitest";
import { decryptWithKey, encryptWithKey, randomToken, safeEqual } from "@/server/crypto";

const key = Buffer.alloc(32, 9).toString("base64");
const otherKey = Buffer.alloc(32, 3).toString("base64");

describe("AES-256-GCM", () => {
  it("round-trips unicode text", () => {
    const enc = encryptWithKey("토큰-abc-🙂", key);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decryptWithKey(enc, key)).toBe("토큰-abc-🙂");
  });

  it("uses a random IV per call", () => {
    expect(encryptWithKey("same", key)).not.toBe(encryptWithKey("same", key));
  });

  it("round-trips an empty string", () => {
    expect(decryptWithKey(encryptWithKey("", key), key)).toBe("");
  });

  it("rejects tampered ciphertext", () => {
    const [v, iv, tag, ct] = encryptWithKey("secret", key).split(":");
    const flipped = Buffer.from(ct, "base64url");
    flipped[0] ^= 0xff;
    expect(() => decryptWithKey([v, iv, tag, flipped.toString("base64url")].join(":"), key)).toThrow();
  });

  it("rejects the wrong key", () => {
    expect(() => decryptWithKey(encryptWithKey("secret", key), otherKey)).toThrow();
  });

  it("rejects malformed payloads", () => {
    expect(() => decryptWithKey("v2:a:b:c", key)).toThrow(/malformed/);
  });
});

describe("helpers", () => {
  it("randomToken returns url-safe strings", () => {
    expect(randomToken(32)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("safeEqual compares strings in constant time", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
