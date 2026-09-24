import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { commentEvents, igAccounts } from "@/server/db/schema";
import { resetDb } from "../helpers/db";
import { createAutomation, createEvent, createIgAccount, createUser } from "../helpers/factories";

describe("schema", () => {
  beforeEach(resetDb);

  it("stores accounts, automations and events with defaults", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const auto = await createAutomation(acct);
    const ev = await createEvent(acct);
    expect(acct.status).toBe("active");
    expect(acct.dmFormat).toBe("button");
    expect(auto.keywords).toEqual(["공구"]);
    expect(ev.status).toBe("pending");
    expect(ev.attempts).toBe(0);
  });

  it("enforces unique comment_id", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createEvent(acct, { commentId: "c-1" });
    const again = await getDb()
      .insert(commentEvents)
      .values({ igAccountId: acct.id, commentId: "c-1", mediaId: "m", commenterIgId: "x" })
      .onConflictDoNothing({ target: commentEvents.commentId })
      .returning();
    expect(again).toHaveLength(0);
  });

  it("cascades account deletion to events", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createEvent(acct);
    await getDb().delete(igAccounts).where(eq(igAccounts.id, acct.id));
    expect(await getDb().select().from(commentEvents)).toHaveLength(0);
  });
});
