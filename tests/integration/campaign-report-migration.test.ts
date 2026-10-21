import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/db";
import { migrationDatabase } from "../helpers/migrations";

describe("report migration", () => {
  beforeEach(resetDb);
  it("roundtrips an unused migration and preserves existing users", async () => {
    const db = await migrationDatabase(9);
    try {
      await db.sql`insert into "user" (id,name,email) values ('fixture','fixture','fixture@example.com')`;
      await db.down("drizzle/rollback/0009_gonggu_reports.sql");
      expect((await db.sql`select to_regclass('report_snapshots') t`)[0].t).toBeNull();
      await db.up(); expect((await db.sql`select to_regclass('report_snapshots') t`)[0].t).toBe("report_snapshots");
      expect(await db.sql`select id from "user"`).toEqual([{ id: "fixture" }]);
    } finally { await db.close(); }
  });
  it("refuses to discard entered totals", async () => {
    const db = await migrationDatabase(9);
    try {
      await db.sql`insert into "user" (id,name,email) values ('fixture','fixture','fixture@example.com')`;
      const [a] = await db.sql`insert into ig_accounts(user_id,ig_user_id,ig_scoped_id,username,account_type) values ('fixture','business','scoped','fixture','BUSINESS') returning id`;
      const [c] = await db.sql`insert into campaigns(user_id,ig_account_id,title,slug,open_at,close_at,notification_keywords,link_keywords,templates,hourly_rate) values ('fixture',${a.id},'fixture','fixture',now(),now()+interval '1 day',ARRAY['알림'],ARRAY['링크'],'{}',400) returning id`;
      await db.sql`insert into manual_order_entries(campaign_id,revision,request_id,order_count,revenue_krw) values (${c.id},1,'fixture',2,100)`;
      await expect(db.down("drizzle/rollback/0009_gonggu_reports.sql")).rejects.toThrow();
      expect((await db.sql`select order_count from manual_order_entries`)[0].order_count).toBe(2);
    } finally { await db.close(); }
  });
});
