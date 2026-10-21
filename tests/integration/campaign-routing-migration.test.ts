import { describe, expect, it } from "vitest";
import { migrationDatabase } from "../helpers/migrations";

describe("campaign routing migration", () => {
  it("rolls down/up while preserving legacy webhook rows and blocks rollback of captured campaign events", async () => {
    const db = await migrationDatabase(3);
    try {
      await db.sql`insert into "user" (id, name, email) values ('owner', '테스터', 'owner@test.local')`;
      const [account] = await db.sql`insert into ig_accounts (user_id, ig_user_id, username, account_type) values ('owner', '123', 'test', 'BUSINESS') returning id`;
      await db.sql`insert into comment_events (ig_account_id, comment_id, media_id, commenter_ig_id) values (${account.id}, 'comment', 'media', 'person')`;
      await db.down("drizzle/rollback/0003_gonggu_routing.sql");
      expect((await db.sql`select status from comment_events`)[0].status).toBe("pending");
      await db.up();
      expect((await db.sql`select route_owner from comment_events`)[0].route_owner).toBe("legacy");
      await db.sql`update comment_events set status = 'campaign_pending', route_owner = 'undecided', flag_checked_at = now()`;
      await expect(db.down("drizzle/rollback/0003_gonggu_routing.sql")).rejects.toThrow("Campaign routing data exists");
      expect((await db.sql`select route_owner from comment_events`)[0].route_owner).toBe("undecided");
    } finally { await db.close(); }
  });
});
