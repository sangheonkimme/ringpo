import { describe, expect, it } from "vitest";
import { migrationDatabase } from "../helpers/migrations";

describe("dispatch migration", () => {
  it("supports empty up/down/up and refuses to discard account budgets", async () => {
    const db = await migrationDatabase(4);
    try {
      await db.down("drizzle/rollback/0004_gonggu_dispatch.sql"); await db.up();
      expect((await db.sql`select value from campaign_policies where key = 'send_permit_ms'`)[0].value).toBe(2000);
      await db.sql`insert into "user" (id, name, email) values ('owner', '테스터', 'owner@test.local')`;
      const [account] = await db.sql`insert into ig_accounts (user_id, ig_user_id, username, account_type) values ('owner', '123', 'test', 'BUSINESS') returning id`;
      await db.sql`insert into account_send_controls (ig_account_id, private_reply_rate, public_reply_rate, message_rate) values (${account.id}, 400, 120, 400)`;
      await expect(db.down("drizzle/rollback/0004_gonggu_dispatch.sql")).rejects.toThrow("Campaign dispatch data exists");
    } finally { await db.close(); }
  });
});
