import { describe, expect, it } from "vitest";
import { migrationDatabase } from "../helpers/migrations";

describe("campaign tracking migration", () => {
  it("supports up/down/up and refuses to remove a catalog already delivered", async () => {
    const db = await migrationDatabase(5);
    try {
      await db.down("drizzle/rollback/0005_gonggu_tracking.sql"); await db.up();
      await db.sql`insert into "user" (id, name, email) values ('owner', '테스터', 'owner@test.local')`;
      const [account] = await db.sql`insert into ig_accounts (user_id, ig_user_id, username, account_type) values ('owner', '123', 'test', 'BUSINESS') returning id`;
      const [campaign] = await db.sql`insert into campaigns (user_id, ig_account_id, title, slug, open_at, close_at, notification_keywords, link_keywords, templates, hourly_rate) values ('owner', ${account.id}, '공구', 'test', now(), now() + interval '1 day', '{}', '{링크}', '{}', 400) returning id`;
      await db.sql`insert into campaign_link_catalogs (code, campaign_id, content_hash, title, brand, products) values ('catalog', ${campaign.id}, 'hash', '공구', '', '[]')`;
      await expect(db.down("drizzle/rollback/0005_gonggu_tracking.sql")).rejects.toThrow("Campaign tracking data exists");
    } finally { await db.close(); }
  });
});
