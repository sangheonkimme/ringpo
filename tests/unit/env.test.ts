import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/env";

const base = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "a".repeat(32),
  IG_APP_ID: "123",
  IG_APP_SECRET: "secret",
  IG_WEBHOOK_VERIFY_TOKEN: "verify-token",
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
};

describe("parseEnv", () => {
  it("applies defaults", () => {
    const env = parseEnv(base);
    expect(env.IG_GRAPH_API_VERSION).toBe("v26.0");
    expect(env.IG_PRIVATE_REPLY_HOURLY_LIMIT).toBe(700);
    expect(env.WORKER_CONCURRENCY).toBe(8);
  });

  it("treats empty strings as unset", () => {
    const env = parseEnv({ ...base, KAKAO_CLIENT_ID: "", META_APP_SECRET: "" });
    expect(env.KAKAO_CLIENT_ID).toBeUndefined();
    expect(env.META_APP_SECRET).toBeUndefined();
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    expect(() => parseEnv({ ...base, ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/ENCRYPTION_KEY/);
  });

  it("rejects an hourly limit above 750", () => {
    expect(() => parseEnv({ ...base, IG_PRIVATE_REPLY_HOURLY_LIMIT: "800" })).toThrow();
  });
});
