import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/db";
import { migrationDatabase } from "../helpers/migrations";
describe("retention migration", () => {
  beforeEach(resetDb);
  it("supports empty up/down/up without erasing earlier tables", async () => {
    const db = await migrationDatabase(12);
    try { await db.down("drizzle/rollback/0012_gonggu_retention.sql"); expect((await db.sql`select to_regclass('campaign_faqs') t`)[0].t).toBe("campaign_faqs"); await db.up(); expect((await db.sql`select value from campaign_policies where key='raw_content_retention_days'`)[0].value).toBe(90); }
    finally { await db.close(); }
  });
  it("refuses to erase evidence of a completed content scrub", async () => {
    const db = await migrationDatabase(12);
    try {
      await db.sql`insert into "user" (id,name,email) values ('fixture','fixture','fixture@example.com')`;
      const [a] = await db.sql`insert into ig_accounts(user_id,ig_user_id,ig_scoped_id,username,account_type) values ('fixture','business','scoped','fixture','BUSINESS') returning id`;
      await db.sql`insert into comment_events(ig_account_id,comment_id,media_id,commenter_ig_id,content_redacted_at) values(${a.id},'comment','media','peer',now())`;
      await expect(db.down("drizzle/rollback/0012_gonggu_retention.sql")).rejects.toThrow();
    } finally { await db.close(); }
  });
});
