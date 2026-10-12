import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { reserveDelivery, releaseDelivery } from "@/server/pipeline/deliveries";
import { getDmUsage, releaseDm, reserveDm } from "@/server/usage";
import { resetDb } from "../helpers/db";
import { createAutomation, createEvent, createIgAccount, createUser } from "../helpers/factories";

const now = new Date("2026-09-24T03:00:00Z");

describe("usage counters", () => {
  beforeEach(resetDb);

  it("reserves until the limit then refuses", async () => {
    const u = await createUser();
    expect(await reserveDm(getDb(), u.id, 2, now)).toBe("2026-09");
    expect(await reserveDm(getDb(), u.id, 2, now)).toBe("2026-09");
    expect(await reserveDm(getDb(), u.id, 2, now)).toBeNull();
    expect(await getDmUsage(getDb(), u.id, now)).toBe(2);
  });

  it("releases one reservation and never goes below zero", async () => {
    const u = await createUser();
    await reserveDm(getDb(), u.id, 5, now);
    await releaseDm(getDb(), u.id, "2026-09");
    await releaseDm(getDb(), u.id, "2026-09");
    expect(await getDmUsage(getDb(), u.id, now)).toBe(0);
  });

  it("concurrent reservations never exceed the limit", async () => {
    const u = await createUser();
    const results = await Promise.all(Array.from({ length: 10 }, () => reserveDm(getDb(), u.id, 3, now)));
    expect(results.filter(Boolean)).toHaveLength(3);
  });
});

describe("deliveries", () => {
  beforeEach(resetDb);

  it("reserves once per automation/media/commenter", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const auto = await createAutomation(acct);
    const e1 = await createEvent(acct);
    const e2 = await createEvent(acct);
    const key = { automationId: auto.id, mediaId: "media-1", commenterIgId: "commenter-1" };
    expect(await reserveDelivery(getDb(), { ...key, eventId: e1.id })).toBe("reserved");
    expect(await reserveDelivery(getDb(), { ...key, eventId: e1.id })).toBe("reserved");
    expect(await reserveDelivery(getDb(), { ...key, eventId: e2.id })).toBe("duplicate");
    await releaseDelivery(getDb(), e1.id);
    expect(await reserveDelivery(getDb(), { ...key, eventId: e2.id })).toBe("reserved");
  });
});
