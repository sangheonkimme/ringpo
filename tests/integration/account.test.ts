import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteUserAccount, disconnectAccount } from "@/server/account";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { automations, igAccounts, links, payments, user } from "@/server/db/schema";
import { resetDb } from "../helpers/db";
import { createAutomation, createIgAccount, createUser, setPlan } from "../helpers/factories";
import { FakeBillingGateway } from "../helpers/fake-billing";

describe("account management", () => {
  beforeEach(resetDb);

  it("disconnects only the owner's account and turns its automations off", async () => {
    const owner = await createUser();
    const other = await createUser();
    const acct = await createIgAccount(owner.id);
    await createAutomation(acct);
    expect(await disconnectAccount(getDb(), other.id, acct.id)).toBe(false);
    expect(await disconnectAccount(getDb(), owner.id, acct.id)).toBe(true);
    const [a] = await getDb().select().from(igAccounts).where(eq(igAccounts.id, acct.id));
    expect(a).toMatchObject({ status: "disconnected", accessTokenEnc: null });
    const [auto] = await getDb().select().from(automations);
    expect(auto.isActive).toBe(false);
  });

  it("deletes the user, their data and billing key but keeps payment records", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const auto = await createAutomation(acct);
    await getDb().insert(links).values({ code: "del-1", automationId: auto.id, targetUrl: "https://shop.example.com" });
    const s = await setPlan(u.id, "pro", { billingKeyEnc: encryptSecret("bk_9") });
    await getDb().insert(payments).values({ userId: u.id, subscriptionId: s.id, paymentId: "pay_1", plan: "pro", amount: 9900, status: "paid" });
    const gateway = new FakeBillingGateway();
    await deleteUserAccount({ db: getDb(), gateway, decrypt: decryptSecret }, u.id);
    expect(gateway.deleted).toEqual(["bk_9"]);
    expect(await getDb().select().from(user)).toHaveLength(0);
    expect(await getDb().select().from(igAccounts)).toHaveLength(0);
    expect(await getDb().select().from(links)).toHaveLength(0);
    const [p] = await getDb().select().from(payments);
    expect(p).toMatchObject({ paymentId: "pay_1", userId: null, subscriptionId: null });
  });
});
