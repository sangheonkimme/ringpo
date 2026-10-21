import { describe, expect, it } from "vitest";
import { DEFAULT_CAMPAIGN_TEMPLATES } from "@/lib/campaign-schema";
import { migrationDatabase } from "../helpers/migrations";

describe("campaign foundation migration", () => {
  it("rolls down and up without touching legacy users and seeds the flag disabled", async () => {
    const db = await migrationDatabase(2);
    try {
      await db.sql`insert into "user" (id, name, email) values ('owner', '테스터', 'owner@test.local')`;
      await db.down("drizzle/rollback/0002_gonggu_foundation.sql");
      expect((await db.sql`select to_regclass('campaigns') as name`)[0].name).toBeNull();
      expect((await db.sql`select id from "user"`)[0].id).toBe("owner");
      await db.up();
      expect((await db.sql`select * from feature_flags`)[0]).toMatchObject({ key: "gonggu_campaigns", enabled: false, default_enabled: false });
      expect(await db.sql`select id from campaigns`).toHaveLength(0);
    } finally { await db.close(); }
  });

  it("refuses to drop existing campaigns", async () => {
    const db = await migrationDatabase(2);
    try {
      await db.sql`insert into "user" (id, name, email) values ('owner', '테스터', 'owner@test.local')`;
      const [account] = await db.sql`insert into ig_accounts (user_id, ig_user_id, username, account_type) values ('owner', '123', 'test', 'BUSINESS') returning id`;
      await db.sql`insert into campaigns (user_id, ig_account_id, title, slug, open_at, close_at, notification_keywords, link_keywords, templates, hourly_rate)
        values ('owner', ${account.id}, '보존', 'keep', '2026-10-22', '2026-10-23', ARRAY['알림'], ARRAY['링크'], ${JSON.stringify(DEFAULT_CAMPAIGN_TEMPLATES)}::jsonb, 400)`;
      await expect(db.down("drizzle/rollback/0002_gonggu_foundation.sql")).rejects.toThrow("Campaign data exists");
      expect(await db.sql`select id from campaigns`).toHaveLength(1);
    } finally { await db.close(); }
  });
});
