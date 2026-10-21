import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/db";
import { migrationDatabase } from "../helpers/migrations";

describe("campaign runtime migration", () => {
  beforeEach(resetDb);
  it("supports empty up/down/up without changing existing automation rows", async () => {
    const db = await migrationDatabase(8);
    try {
      await db.sql`insert into "user" (id, name, email) values ('fixture','fixture','fixture@example.com')`;
      await db.down("drizzle/rollback/0008_gonggu_runtime.sql");
      expect((await db.sql`select count(*)::int n from information_schema.columns where table_name='message_events' and column_name='legacy_event_id'`)[0].n).toBe(0);
      await db.up();
      expect((await db.sql`select count(*)::int n from information_schema.columns where table_name='message_events' and column_name='legacy_event_id'`)[0].n).toBe(1);
      expect(await db.sql`select id from "user"`).toEqual([{ id: "fixture" }]);
    } finally { await db.close(); }
  });
  it("refuses to remove an unknown-send marker", async () => {
    const db = await migrationDatabase(8);
    try {
      await db.sql`insert into "user" (id, name, email) values ('fixture','fixture','fixture@example.com')`;
      const [account] = await db.sql`insert into ig_accounts (user_id, ig_user_id, ig_scoped_id, username, account_type) values ('fixture','business','scoped','fixture','BUSINESS') returning id`;
      await db.sql`insert into message_events (ig_account_id, peer_id, event_key, kind, received_at, user_message_evidence, next_attempt_at, status) values (${account.id},'peer','m1','message',now(),false,now(),'send_unknown')`;
      await expect(db.down("drizzle/rollback/0008_gonggu_runtime.sql")).rejects.toThrow();
      expect((await db.sql`select status from message_events`)[0].status).toBe("send_unknown");
    } finally { await db.close(); }
  });
});
