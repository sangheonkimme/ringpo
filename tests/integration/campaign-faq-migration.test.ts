import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/db";
import { migrationDatabase } from "../helpers/migrations";
describe("FAQ migration", () => {
  beforeEach(resetDb);
  it("supports unused up/down/up and keeps earlier report tables", async () => {
    const db = await migrationDatabase(11);
    try { await db.down("drizzle/rollback/0011_gonggu_faq.sql"); expect((await db.sql`select to_regclass('report_shares') t`)[0].t).toBe("report_shares"); await db.up(); expect((await db.sql`select enabled from feature_flags where key = 'gonggu_faq_handoff_verified'`)[0].enabled).toBe(false); }
    finally { await db.close(); }
  });
  it("refuses to erase a recorded handoff verification", async () => {
    const db = await migrationDatabase(11);
    try {
      await db.sql`insert into "user" (id,name,email) values ('fixture','fixture','fixture@example.com')`;
      const [a] = await db.sql`insert into ig_accounts(user_id,ig_user_id,ig_scoped_id,username,account_type) values ('fixture','business','scoped','fixture','BUSINESS') returning id`;
      await db.sql`insert into feature_flag_overrides(flag_key,ig_account_id,enabled) values ('gonggu_faq_handoff_verified',${a.id},true)`;
      await expect(db.down("drizzle/rollback/0011_gonggu_faq.sql")).rejects.toThrow();
    } finally { await db.close(); }
  });
});
