import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/db";
import { migrationDatabase } from "../helpers/migrations";
describe("operations migration", () => {
  beforeEach(resetDb);
  it("supports empty up/down/up without changing retention records", async () => {
    const db = await migrationDatabase(13);
    try {
      await db.down("drizzle/rollback/0013_gonggu_operations.sql");
      expect((await db.sql`select value from campaign_policies where key='raw_content_retention_days'`)[0].value).toBe(90);
      await db.up(); expect((await db.sql`select value from campaign_policies where key='manual_retry_extra_attempts'`)[0].value).toBe(5);
    } finally { await db.close(); }
  });
});
