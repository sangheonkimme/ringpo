import { beforeEach, describe, expect, it } from "vitest";
import { PLANS } from "@/lib/plans";
import { deleteAutomation, getAutomation, listAutomations, setAutomationActive } from "@/server/automations/service";
import { getDb } from "@/server/db/client";
import { resetDb } from "../helpers/db";
import { createAutomation, createIgAccount, createUser, setPlan } from "../helpers/factories";

describe("automation service", () => {
  beforeEach(resetDb);

  it("isolates automations per user", async () => {
    const a = await createUser();
    const b = await createUser();
    const acct = await createIgAccount(a.id);
    const auto = await createAutomation(acct);
    expect(await getAutomation(getDb(), b.id, auto.id)).toBeNull();
    expect(await setAutomationActive(getDb(), b.id, auto.id, false)).toEqual({ ok: false, reason: "not_found" });
    expect(await deleteAutomation(getDb(), b.id, auto.id)).toBe(false);
    expect(await listAutomations(getDb(), a.id)).toHaveLength(1);
  });

  it("enforces the free plan's active automation limit", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    for (let i = 0; i < PLANS.free.maxActiveAutomations!; i++) await createAutomation(acct, { isActive: true });
    const second = await createAutomation(acct, { isActive: false });
    expect(await setAutomationActive(getDb(), u.id, second.id, true)).toEqual({ ok: false, reason: "limit" });
    await setPlan(u.id, "pro");
    expect(await setAutomationActive(getDb(), u.id, second.id, true)).toEqual({ ok: true });
  });

  it("refuses to activate automations of disconnected accounts", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id, { status: "reauth_required" });
    const auto = await createAutomation(acct, { isActive: false });
    expect(await setAutomationActive(getDb(), u.id, auto.id, true)).toEqual({ ok: false, reason: "account_inactive" });
  });
});
