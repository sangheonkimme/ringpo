const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/igc_test";

Object.assign(process.env, {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: TEST_DB,
  BETTER_AUTH_SECRET: "test-secret-".padEnd(40, "x"),
  IG_APP_ID: "ig-app-id",
  IG_APP_SECRET: "ig-app-secret",
  META_APP_SECRET: "meta-app-secret",
  IG_WEBHOOK_VERIFY_TOKEN: "verify-token-123",
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  PORTONE_WEBHOOK_SECRET: Buffer.from("portone-webhook-secret").toString("base64"),
});
