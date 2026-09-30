import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { commentEvents, igAccounts } from "@/server/db/schema";
import { reserveSendSlot } from "@/server/ratelimit";
import { resetDb } from "../helpers/db";
import { createEvent, createIgAccount, createUser } from "../helpers/factories";

const HOUR = 3_600_000;

async function setup(nextReplyAt: Date) {
  const u = await createUser();
  const acct = await createIgAccount(u.id, { nextReplyAt });
  return acct;
}

describe("reserveSendSlot", () => {
  beforeEach(resetDb);

  it("returns now for an idle account and spaces the next slot by 1-3s", async () => {
    const now = new Date();
    const acct = await setup(new Date(now.getTime() - 60_000));
    const e1 = await createEvent(acct);
    const e2 = await createEvent(acct);
    const s1 = await reserveSendSlot(getDb(), { igAccountId: acct.id, eventId: e1.id, now, hourlyLimit: 700, random: () => 0 });
    const s2 = await reserveSendSlot(getDb(), { igAccountId: acct.id, eventId: e2.id, now, hourlyLimit: 700, random: () => 0.5 });
    expect(s1.getTime()).toBe(now.getTime());
    expect(s2.getTime()).toBe(now.getTime() + 1000);
    const [row] = await getDb().select().from(commentEvents).where(eq(commentEvents.id, e2.id));
    expect(row.dmReservedAt?.getTime()).toBe(s2.getTime());
    const [a] = await getDb().select().from(igAccounts).where(eq(igAccounts.id, acct.id));
    expect(a.nextReplyAt.getTime()).toBe(s2.getTime() + 2000);
  });

  it("pushes the slot past the hourly window when the limit is reached", async () => {
    const now = new Date();
    const acct = await setup(now);
    const events = await Promise.all([1, 2, 3, 4].map(() => createEvent(acct)));
    const slots: Date[] = [];
    for (const e of events) {
      slots.push(await reserveSendSlot(getDb(), { igAccountId: acct.id, eventId: e.id, now, hourlyLimit: 3, random: () => 0 }));
    }
    expect(slots[3].getTime()).toBe(slots[0].getTime() + HOUR);
  });

  it("gives distinct increasing slots under concurrency", async () => {
    const now = new Date();
    const acct = await setup(now);
    const events = await Promise.all(Array.from({ length: 6 }, () => createEvent(acct)));
    const slots = await Promise.all(
      events.map((e) => reserveSendSlot(getDb(), { igAccountId: acct.id, eventId: e.id, now, hourlyLimit: 700, random: () => 0 })),
    );
    const sorted = slots.map((s) => s.getTime()).sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(1000);
  });

  it("keeps accounts independent", async () => {
    const now = new Date();
    const a = await setup(new Date(now.getTime() + 600_000));
    const b = await setup(now);
    const eb = await createEvent(b);
    const slot = await reserveSendSlot(getDb(), { igAccountId: b.id, eventId: eb.id, now, hourlyLimit: 700, random: () => 0 });
    expect(slot.getTime()).toBe(now.getTime());
    expect(a.id).not.toBe(b.id);
  });
});
