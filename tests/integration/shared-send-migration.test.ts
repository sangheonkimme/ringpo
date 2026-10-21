import { describe, expect, it } from "vitest";
import { migrationDatabase } from "../helpers/migrations";

describe("shared budget migration", () => {
  it("supports empty up/down/up and preserves observed flag transition history", async () => {
    const db = await migrationDatabase(6);
    try {
      await db.down("drizzle/rollback/0006_gonggu_shared_budget.sql"); await db.up();
      await db.sql`insert into "user" (id, name, email) values ('owner', '테스터', 'owner@test.local')`;
      const [account] = await db.sql`insert into ig_accounts (user_id, ig_user_id, username, account_type) values ('owner', '123', 'test', 'BUSINESS') returning id`;
      await db.sql`insert into account_send_controls (ig_account_id, private_reply_rate, public_reply_rate, message_rate, last_observed_enabled) values (${account.id}, 400, 120, 400, false)`;
      await expect(db.down("drizzle/rollback/0006_gonggu_shared_budget.sql")).rejects.toThrow("Shared send history exists");
    } finally { await db.close(); }
  });
});
