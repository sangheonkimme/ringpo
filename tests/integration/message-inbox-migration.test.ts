import { beforeEach, describe, expect, it } from "vitest";
import { messageEvents } from "@/server/db/schema";
import { resetDb } from "../helpers/db";
import { migrationDatabase } from "../helpers/migrations";

describe("message inbox migration", () => {
  beforeEach(resetDb);
  it("supports an empty up/down/up", async () => {
    const db = await migrationDatabase(7);
    try {
      await db.down("drizzle/rollback/0007_gonggu_message_inbox.sql");
      expect((await db.sql`select to_regclass('message_events') as name`)[0].name).toBeNull();
      await db.up(); expect(await db.db.select().from(messageEvents)).toEqual([]);
    } finally { await db.close(); }
  });
  it("refuses rollback after a received message rather than losing deduplication evidence", async () => {
    const db = await migrationDatabase(7);
    try {
      await db.sql`insert into "user" (id, name, email) values ('fixture', 'fixture', 'fixture@example.com')`;
      const [account] = await db.sql`insert into ig_accounts (user_id, ig_user_id, ig_scoped_id, username, account_type) values ('fixture','business','scoped','fixture','BUSINESS') returning id`;
      await db.db.insert(messageEvents).values({ igAccountId: account.id, peerId: "person", eventKey: "message:m1", kind: "message", providerMessageId: "m1", occurredAt: new Date(), receivedAt: new Date(), userMessageEvidence: true, nextAttemptAt: new Date() });
      await expect(db.down("drizzle/rollback/0007_gonggu_message_inbox.sql")).rejects.toThrow();
      expect(await db.db.select().from(messageEvents)).toHaveLength(1);
    } finally { await db.close(); }
  });
});
