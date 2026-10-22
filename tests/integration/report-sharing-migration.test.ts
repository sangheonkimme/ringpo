import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/db";
import { migrationDatabase } from "../helpers/migrations";

describe("report sharing migration", () => {
  beforeEach(resetDb);
  it("roundtrips unused tables and preserves existing auth users", async () => {
    const db = await migrationDatabase(10);
    try {
      await db.sql`insert into "user" (id,name,email) values ('fixture','fixture','fixture@example.com')`;
      await db.down("drizzle/rollback/0010_gonggu_report_sharing.sql"); expect((await db.sql`select to_regclass('report_shares') t`)[0].t).toBeNull();
      await db.up(); expect((await db.sql`select to_regclass('report_shares') t`)[0].t).toBe("report_shares");
      expect(await db.sql`select id from "user"`).toEqual([{ id: "fixture" }]);
    } finally { await db.close(); }
  });
  it("refuses to erase a report's possibly issued direct-PDF attribution code", async () => {
    const db = await migrationDatabase(10);
    try {
      await db.sql`insert into "user" (id,name,email) values ('fixture','fixture','fixture@example.com')`;
      const [a] = await db.sql`insert into ig_accounts(user_id,ig_user_id,ig_scoped_id,username,account_type) values ('fixture','business','scoped','fixture','BUSINESS') returning id`;
      const [c] = await db.sql`insert into campaigns(user_id,ig_account_id,title,slug,open_at,close_at,notification_keywords,link_keywords,templates,hourly_rate) values ('fixture',${a.id},'fixture','fixture',now(),now()+interval '1 day',ARRAY['알림'],ARRAY['링크'],'{}',400) returning id`;
      const [s] = await db.sql`insert into report_snapshots(campaign_id,revision,source_key,as_of,data) values (${c.id},1,'fixture',now(),'{}') returning referral_code`;
      expect(s.referral_code).toMatch(/^[a-f0-9]{32}$/);
      await expect(db.down("drizzle/rollback/0010_gonggu_report_sharing.sql")).rejects.toThrow();
      expect((await db.sql`select referral_code from report_snapshots`)[0].referral_code).toBe(s.referral_code);
    } finally { await db.close(); }
  });
});
