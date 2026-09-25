import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { links, usageCounters } from "@/server/db/schema";
import { getDashboard } from "@/server/dashboard";
import { usagePeriod } from "@/server/usage";
import { resetDb } from "../helpers/db";
import { createAutomation, createEvent, createIgAccount, createUser } from "../helpers/factories";

describe("getDashboard", () => {
  beforeEach(resetDb);

  it("aggregates per-automation stats, clicks, usage and waiting count", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const auto = await createAutomation(acct);
    const now = new Date();
    await createEvent(acct, { automationId: auto.id, status: "succeeded" });
    await createEvent(acct, { automationId: auto.id, status: "succeeded" });
    await createEvent(acct, { automationId: auto.id, status: "failed", errorCode: "551" });
    await createEvent(acct, { automationId: auto.id, status: "pending", runAt: new Date(now.getTime() + 60_000) });
    await createEvent(acct, { automationId: auto.id, status: "skipped", skipReason: "duplicate" });
    await createEvent(acct, { status: "skipped", skipReason: "no_match" });
    await getDb().insert(links).values([
      { code: "aaaaaaa", automationId: auto.id, targetUrl: "https://x", clickCount: 3 },
      { code: "bbbbbbb", automationId: auto.id, targetUrl: "https://x", clickCount: 0 },
    ]);
    await getDb().insert(usageCounters).values({ userId: u.id, period: usagePeriod(now), dmCount: 42 });

    const d = await getDashboard(getDb(), u.id, now);
    expect(d.plan.id).toBe("free");
    expect(d.usage).toBe(42);
    expect(d.waiting).toBe(1);
    expect(d.automations[0].stats).toEqual({ total: 5, succeeded: 2, partial: 0, failed: 1, pending: 1, skipped: 1, linksSent: 2, linksClicked: 1, clicks: 3 });
    expect(d.recent).toHaveLength(5);
    expect(d.recent.every((r) => r.automationName === "공구 자동화")).toBe(true);
  });

  it("flags an account whose latest DM was blocked because message access is off", async () => {
    const u = await createUser();
    const blocked = await createIgAccount(u.id, { username: "blocked.shop" });
    const fine = await createIgAccount(u.id, { username: "fine.shop" });
    const t = (min: number) => new Date(Date.now() - min * 60_000);
    await createEvent(blocked, { status: "succeeded", dmStatus: "sent", completedAt: t(30) });
    await createEvent(blocked, { status: "partial", dmStatus: "failed", errorCode: "200/2534041", completedAt: t(5) });
    await createEvent(fine, { status: "partial", dmStatus: "failed", errorCode: "200/2534041", completedAt: t(30) });
    await createEvent(fine, { status: "succeeded", dmStatus: "sent", completedAt: t(5) });
    await createEvent(fine, { status: "failed", dmStatus: "failed", errorCode: "551", completedAt: t(1) });
    const d = await getDashboard(getDb(), u.id, new Date());
    const byName = Object.fromEntries(d.accounts.map((a) => [a.username, a.dmBlocked]));
    expect(byName).toEqual({ "blocked.shop": true, "fine.shop": false });
  });

  it("does not leak other users' data", async () => {
    const a = await createUser();
    const b = await createUser();
    const acct = await createIgAccount(a.id);
    const auto = await createAutomation(acct);
    await createEvent(acct, { automationId: auto.id, status: "succeeded" });
    const d = await getDashboard(getDb(), b.id, new Date());
    expect(d.automations).toHaveLength(0);
    expect(d.recent).toHaveLength(0);
  });
});
