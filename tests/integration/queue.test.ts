import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { commentEvents } from "@/server/db/schema";
import { claimEvents, enqueueComments, finishEvent, requeueEvent } from "@/server/queue/events";
import { resetDb } from "../helpers/db";
import { createEvent, createIgAccount, createUser } from "../helpers/factories";

describe("queue", () => {
  beforeEach(resetDb);

  it("enqueue is idempotent by comment_id", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const row = { igAccountId: acct.id, commentId: "c-1", mediaId: "m", commenterIgId: "x", commentText: "공구" };
    expect(await enqueueComments(getDb(), [row, { ...row }])).toBe(1);
    expect(await enqueueComments(getDb(), [row])).toBe(0);
    expect(await getDb().select().from(commentEvents)).toHaveLength(1);
  });

  it("claims only due pending events and marks them processing", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const now = new Date();
    const due = await createEvent(acct, { runAt: new Date(now.getTime() - 1000) });
    await createEvent(acct, { runAt: new Date(now.getTime() + 60_000) });
    const claimed = await claimEvents(getDb(), { batch: 10, now });
    expect(claimed.map((e) => e.id)).toEqual([due.id]);
    expect(claimed[0]).toMatchObject({ status: "processing", attempts: 1 });
  });

  it("never hands the same event to two concurrent claimers", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await Promise.all(Array.from({ length: 10 }, () => createEvent(acct, { runAt: new Date(Date.now() - 1000) })));
    const now = new Date();
    const [a, b] = await Promise.all([claimEvents(getDb(), { batch: 6, now }), claimEvents(getDb(), { batch: 6, now })]);
    const ids = [...a, ...b].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(10);
  });

  it("reclaims events stuck in processing for over 5 minutes", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const now = new Date();
    const stuck = await createEvent(acct, { status: "processing", lockedAt: new Date(now.getTime() - 6 * 60_000), attempts: 1 });
    const claimed = await claimEvents(getDb(), { batch: 10, now });
    expect(claimed.map((e) => e.id)).toEqual([stuck.id]);
    expect(claimed[0].attempts).toBe(2);
  });

  it("requeue can refund the attempt and finish records completion", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const ev = await createEvent(acct, { status: "processing", attempts: 2 });
    const runAt = new Date(Date.now() + 300_000);
    await requeueEvent(getDb(), ev.id, runAt, { errorCode: "613" }, { refundAttempt: true });
    let [row] = await getDb().select().from(commentEvents).where(eq(commentEvents.id, ev.id));
    expect(row).toMatchObject({ status: "pending", attempts: 1, errorCode: "613", lockedAt: null });
    expect(row.runAt.getTime()).toBe(runAt.getTime());
    await finishEvent(getDb(), ev.id, "succeeded", { dmStatus: "sent" });
    [row] = await getDb().select().from(commentEvents).where(eq(commentEvents.id, ev.id));
    expect(row.status).toBe("succeeded");
    expect(row.completedAt).not.toBeNull();
  });
});
