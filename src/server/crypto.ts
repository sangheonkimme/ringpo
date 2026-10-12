import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/server/env";

const VERSION = "v1";

function keyFrom(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
  return key;
}

export function encryptWithKey(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(keyB64), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":");
}

export function decryptWithKey(payload: string, keyB64: string): string {
  const parts = payload.split(":");
  const [version, iv, tag, ct] = parts;
  if (parts.length !== 4 || version !== VERSION || !iv || !tag) throw new Error("malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(keyB64), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export function encryptSecret(plain: string): string {
  return encryptWithKey(plain, getEnv().ENCRYPTION_KEY);
}

export function decryptSecret(payload: string): string {
  return decryptWithKey(payload, getEnv().ENCRYPTION_KEY);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
