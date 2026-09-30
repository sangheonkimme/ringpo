import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { automations, igAccounts } from "@/server/db/schema";
import { connectInstagramAccount, type ConnectDeps } from "@/server/instagram/connect";
import { GraphApiError } from "@/server/instagram/errors";
import { resetDb } from "../helpers/db";
import { createAutomation, createIgAccount, createUser } from "../helpers/factories";
import { FakeGraphClient } from "../helpers/fake-graph";

let graph: FakeGraphClient;

function deps(overrides: Partial<ConnectDeps> = {}): ConnectDeps {
  return {
    db: getDb(),
    graph,
    exchangeCode: async () => ({ accessToken: "short" }),
    exchangeLongLived: async () => ({ accessToken: "long-token", expiresIn: 5_184_000 }),
    encrypt: encryptSecret,
    now: () => new Date("2026-09-24T00:00:00Z"),
    ...overrides,
  };
}

describe("connectInstagramAccount", () => {
  beforeEach(async () => {
    await resetDb();
    graph = new FakeGraphClient();
  });

  it("stores the account with an encrypted long-lived token and subscribes webhooks", async () => {
    const u = await createUser();
    const res = await connectInstagramAccount(deps(), { userId: u.id, code: "c" });
    expect(res.ok).toBe(true);
    const [row] = await getDb().select().from(igAccounts);
    expect(row).toMatchObject({ userId: u.id, igUserId: "17841400000000001", igScopedId: "scoped-1", username: "creator", accountType: "BUSINESS", status: "active" });
    expect(decryptSecret(row.accessTokenEnc ?? "")).toBe("long-token");
    expect(row.tokenExpiresAt?.toISOString()).toBe("2026-11-23T00:00:00.000Z");
    expect(graph.subscribed).toEqual(["17841400000000001"]);
  });

  it("rejects personal accounts", async () => {
    const u = await createUser();
    graph.profile = { ...graph.profile, accountType: "PERSONAL" };
    expect(await connectInstagramAccount(deps(), { userId: u.id, code: "c" })).toEqual({ ok: false, reason: "not_professional" });
  });

  it("rejects an account already connected by another user", async () => {
    const owner = await createUser();
    await createIgAccount(owner.id, { igUserId: "17841400000000001" });
    const other = await createUser();
    expect(await connectInstagramAccount(deps(), { userId: other.id, code: "c" })).toEqual({ ok: false, reason: "owned_by_other" });
  });

  it("lets another user take over an account its previous owner disconnected, dropping the old owner's data", async () => {
    const owner = await createUser();
    const old = await createIgAccount(owner.id, { igUserId: "17841400000000001", status: "disconnected", accessTokenEnc: null });
    await createAutomation(old);
    const other = await createUser();
    const res = await connectInstagramAccount(deps(), { userId: other.id, code: "c" });
    expect(res.ok).toBe(true);
    const rows = await getDb().select().from(igAccounts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: other.id, status: "active" });
    expect(await getDb().select().from(automations)).toHaveLength(0);
  });

  it("enforces the plan account limit but allows reconnecting the same account", async () => {
    const u = await createUser();
    await createIgAccount(u.id, { igUserId: "999" });
    expect(await connectInstagramAccount(deps(), { userId: u.id, code: "c" })).toEqual({ ok: false, reason: "limit" });
    graph.profile = { ...graph.profile, userId: "999" };
    expect((await connectInstagramAccount(deps(), { userId: u.id, code: "c" })).ok).toBe(true);
  });

  it("reports OAuth failures", async () => {
    const u = await createUser();
    const res = await connectInstagramAccount(
      deps({ exchangeCode: async () => { throw new GraphApiError("bad code", 400, 400); } }),
      { userId: u.id, code: "c" },
    );
    expect(res).toEqual({ ok: false, reason: "oauth_failed" });
  });
});
