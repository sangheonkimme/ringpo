import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { commentEvents, deliveries, igAccounts, usageCounters, workerHeartbeats } from "@/server/db/schema";
import { GraphApiError } from "@/server/instagram/errors";
import { usagePeriod } from "@/server/usage";
import { beat, cleanupOldData, expireStaleEvents, refreshExpiringTokens, withJobLock } from "@/worker/jobs";
import { resetDb } from "../helpers/db";
import { createAutomation, createEvent, createIgAccount, createUser } from "../helpers/factories";
import { FakeGraphClient } from "../helpers/fake-graph";

const DAY = 86_400_000;

describe("worker jobs", () => {
  beforeEach(resetDb);

  it("refreshes tokens that expire within 7 days", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id, { tokenExpiresAt: new Date(Date.now() + 3 * DAY) });
    const graph = new FakeGraphClient();
    const now = new Date();
    const res = await refreshExpiringTokens({ db: getDb(), graph, now: () => now, encrypt: encryptSecret, decrypt: decryptSecret });
    expect(res.refreshed).toBe(1);
    const [row] = await getDb().select().from(igAccounts).where(eq(igAccounts.id, acct.id));
    expect(decryptSecret(row.accessTokenEnc ?? "")).toBe("refreshed");
    expect(row.tokenExpiresAt?.getTime()).toBe(now.getTime() + 5_184_000_000);
  });

  it("flags accounts whose refresh is rejected or already expired", async () => {
    const u = await createUser();
    const rejected = await createIgAccount(u.id, { tokenExpiresAt: new Date(Date.now() + DAY) });
    const expired = await createIgAccount(u.id, { tokenExpiresAt: new Date(Date.now() - DAY) });
    const graph = new FakeGraphClient();
    graph.refreshResult = new GraphApiError("invalid", 400, 190);
    const notified: string[] = [];
    const res = await refreshExpiringTokens({
      db: getDb(),
      graph,
      now: () => new Date(),
      encrypt: encryptSecret,
      decrypt: decryptSecret,
      onReauthRequired: async (a) => {
        notified.push(a.id);
      },
    });
    expect(res.flagged).toBe(2);
    const rows = await getDb().select().from(igAccounts);
    expect(rows.every((r) => r.status === "reauth_required")).toBe(true);
    expect(notified.sort()).toEqual([rejected.id, expired.id].sort());
  });

  it("expires pending events older than 7 days and releases reservations", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const auto = await createAutomation(acct);
    const period = usagePeriod(new Date());
    await getDb().insert(usageCounters).values({ userId: u.id, period, dmCount: 1 });
    const ev = await createEvent(acct, { receivedAt: new Date(Date.now() - 8 * DAY), automationId: auto.id, usagePeriod: period });
    await getDb().insert(deliveries).values({ automationId: auto.id, mediaId: ev.mediaId, commenterIgId: ev.commenterIgId, eventId: ev.id });
    expect(await expireStaleEvents(getDb(), new Date())).toBe(1);
    const [row] = await getDb().select().from(commentEvents).where(eq(commentEvents.id, ev.id));
    expect(row.status).toBe("expired");
    expect(await getDb().select().from(deliveries)).toHaveLength(0);
    const [usage] = await getDb().select().from(usageCounters);
    expect(usage.dmCount).toBe(0);
  });

  it("deletes old no-match events after 3 days and everything after 180 days", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const now = new Date();
    await createEvent(acct, { status: "skipped", skipReason: "no_match", createdAt: new Date(now.getTime() - 4 * DAY) });
    const keep = await createEvent(acct, { status: "succeeded", createdAt: new Date(now.getTime() - 4 * DAY) });
    await createEvent(acct, { status: "succeeded", createdAt: new Date(now.getTime() - 181 * DAY) });
    await cleanupOldData(getDb(), now);
    const rows = await getDb().select().from(commentEvents);
    expect(rows.map((r) => r.id)).toEqual([keep.id]);
  });

  it("records heartbeats and serializes jobs with an advisory lock", async () => {
    await beat(getDb(), "w1", new Date());
    expect(await getDb().select().from(workerHeartbeats)).toHaveLength(1);
    let inner: boolean | null = null;
    const outer = await withJobLock(getDb(), "job-a", async () => {
      inner = await withJobLock(getDb(), "job-a", async () => {});
    });
    expect(outer).toBe(true);
    expect(inner).toBe(false);
  });
});
