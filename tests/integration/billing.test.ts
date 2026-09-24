import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  processDueRenewals,
  renewalPaymentId,
  scheduleDowngrade,
  setCancelAtPeriodEnd,
  subscribe,
  syncPayment,
  type BillingDeps,
} from "@/server/billing/subscriptions";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { automations, payments, subscriptions } from "@/server/db/schema";
import { resetDb } from "../helpers/db";
import { createAutomation, createIgAccount, createUser, setPlan } from "../helpers/factories";
import { FakeBillingGateway } from "../helpers/fake-billing";

let gateway: FakeBillingGateway;
let notices: string[];
let clock: Date;

function deps(): BillingDeps {
  return {
    db: getDb(),
    gateway,
    now: () => clock,
    encrypt: encryptSecret,
    decrypt: decryptSecret,
    notify: {
      paymentFailed: async (userId, plan) => void notices.push(`failed:${userId}:${plan}`),
      downgraded: async (userId, reason) => void notices.push(`downgraded:${userId}:${reason}`),
    },
  };
}

async function sub(userId: string) {
  const [row] = await getDb().select().from(subscriptions).where(eq(subscriptions.userId, userId));
  return row;
}

describe("billing", () => {
  beforeEach(async () => {
    await resetDb();
    gateway = new FakeBillingGateway();
    notices = [];
    clock = new Date("2026-01-30T16:00:00Z"); // 2026-01-31 01:00 KST
  });

  it("subscribes to pro: charges once and activates a monthly period", async () => {
    const u = await createUser();
    gateway.issueKey("bk_1", u.id);
    expect(await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" })).toEqual({ ok: true, charged: true });
    expect(gateway.charges).toHaveLength(1);
    expect(gateway.charges[0]).toMatchObject({ amount: 9900, orderName: "리치업 Pro 월 구독", customer: { id: u.id, name: "홍길동", phone: "01012345678" } });
    const s = await sub(u.id);
    expect(s).toMatchObject({ plan: "pro", status: "active", cardLabel: "신한카드 **** 1234", retryCount: 0 });
    expect(decryptSecret(s.billingKeyEnc ?? "")).toBe("bk_1");
    expect(s.currentPeriodEnd?.toISOString()).toBe("2026-02-27T16:00:00.000Z");
    const [p] = await getDb().select().from(payments);
    expect(p).toMatchObject({ status: "paid", plan: "pro", amount: 9900 });
  });

  it("rejects billing keys issued to someone else", async () => {
    const u = await createUser();
    gateway.issueKey("bk_x", "other-user");
    const res = await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_x" });
    expect(res.ok).toBe(false);
    expect(gateway.charges).toHaveLength(0);
  });

  it("keeps the user on free and deletes the new key when the first charge fails", async () => {
    const u = await createUser();
    gateway.issueKey("bk_1", u.id);
    gateway.nextCharge = () => ({ status: "failed", reason: "잔액 부족" });
    const res = await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" });
    expect(res).toEqual({ ok: false, error: "결제에 실패했어요: 잔액 부족" });
    expect(await sub(u.id)).toMatchObject({ plan: "free", billingKeyEnc: null });
    expect(gateway.deleted).toEqual(["bk_1"]);
    const [p] = await getDb().select().from(payments);
    expect(p.status).toBe("failed");
  });

  it("treats the same plan as a card change without charging", async () => {
    const u = await createUser();
    gateway.issueKey("bk_1", u.id);
    gateway.issueKey("bk_2", u.id, { cardLabel: "현대카드 **** 9999" });
    await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" });
    expect(await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_2" })).toEqual({ ok: true, charged: false });
    expect(gateway.charges).toHaveLength(1);
    expect(gateway.deleted).toEqual(["bk_1"]);
    expect((await sub(u.id)).cardLabel).toBe("현대카드 **** 9999");
  });

  it("upgrades pro to agency with an immediate charge and a new period", async () => {
    const u = await createUser();
    gateway.issueKey("bk_1", u.id);
    await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" });
    clock = new Date("2026-02-10T00:00:00Z");
    gateway.issueKey("bk_2", u.id);
    await subscribe(deps(), { userId: u.id, email: u.email, plan: "agency", billingKey: "bk_2" });
    expect(gateway.charges.map((c) => c.amount)).toEqual([9900, 59000]);
    const s = await sub(u.id);
    expect(s.plan).toBe("agency");
    expect(s.currentPeriodStart?.toISOString()).toBe("2026-02-10T00:00:00.000Z");
  });

  it("keeps the current plan and card when an upgrade charge is declined", async () => {
    const u = await createUser();
    gateway.issueKey("bk_1", u.id);
    await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" });
    gateway.issueKey("bk_2", u.id);
    gateway.nextCharge = () => ({ status: "failed", reason: "한도 초과" });
    expect((await subscribe(deps(), { userId: u.id, email: u.email, plan: "agency", billingKey: "bk_2" })).ok).toBe(false);
    const s = await sub(u.id);
    expect(s.plan).toBe("pro");
    expect(decryptSecret(s.billingKeyEnc ?? "")).toBe("bk_1");
    expect(gateway.deleted).toEqual(["bk_2"]);
  });

  it("renews due subscriptions using the anchor day", async () => {
    const u = await createUser();
    gateway.issueKey("bk_1", u.id);
    await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" });
    const before = await sub(u.id);
    clock = new Date("2026-02-27T16:05:00Z");
    expect(await processDueRenewals(deps())).toBe(1);
    expect(gateway.charges[1].paymentId).toBe(renewalPaymentId(before.id, before.currentPeriodEnd!, 0));
    expect(gateway.charges[1].customer.email).toBe(u.email);
    const s = await sub(u.id);
    expect(s.currentPeriodStart?.toISOString()).toBe("2026-02-27T16:00:00.000Z");
    expect(s.currentPeriodEnd?.toISOString()).toBe("2026-03-30T16:00:00.000Z");
    expect(await processDueRenewals(deps())).toBe(0);
  });

  it("retries failed renewals daily and downgrades after the third failure", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createAutomation(acct, { isActive: true });
    await createAutomation(acct, { isActive: true });
    gateway.issueKey("bk_1", u.id);
    await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" });
    gateway.nextCharge = () => ({ status: "failed", reason: "한도 초과" });

    clock = new Date("2026-02-27T16:05:00Z");
    await processDueRenewals(deps());
    let s = await sub(u.id);
    expect(s).toMatchObject({ status: "past_due", retryCount: 1, plan: "pro" });
    expect(s.nextRetryAt?.getTime()).toBe(clock.getTime() + 86_400_000);

    clock = new Date(clock.getTime() + 86_400_000 + 1000);
    await processDueRenewals(deps());
    clock = new Date(clock.getTime() + 86_400_000 + 1000);
    await processDueRenewals(deps());

    s = await sub(u.id);
    expect(s).toMatchObject({ plan: "free", status: "active", billingKeyEnc: null, currentPeriodEnd: null });
    expect(gateway.deleted).toContain("bk_1");
    const active = await getDb().select().from(automations).where(eq(automations.isActive, true));
    expect(active).toHaveLength(1);
    expect(notices.filter((n) => n.startsWith("failed"))).toHaveLength(2);
    expect(notices).toContain(`downgraded:${u.id}:payment_failed`);
  });

  it("downgrades at period end without charging when canceled", async () => {
    const u = await createUser();
    gateway.issueKey("bk_1", u.id);
    await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" });
    expect(await setCancelAtPeriodEnd(getDb(), u.id, true)).toBe(true);
    clock = new Date("2026-02-28T00:00:00Z");
    await processDueRenewals(deps());
    expect(gateway.charges).toHaveLength(1);
    expect((await sub(u.id)).plan).toBe("free");
    expect(notices).toContain(`downgraded:${u.id}:canceled`);
  });

  it("applies a scheduled downgrade at renewal with the lower price and limits", async () => {
    const u = await createUser();
    const a1 = await createIgAccount(u.id, { createdAt: new Date("2026-01-01T00:00:00Z") });
    const a2 = await createIgAccount(u.id, { createdAt: new Date("2026-01-02T00:00:00Z") });
    await createAutomation(a1, { isActive: true });
    await createAutomation(a2, { isActive: true });
    gateway.issueKey("bk_1", u.id);
    await subscribe(deps(), { userId: u.id, email: u.email, plan: "agency", billingKey: "bk_1" });
    expect(await scheduleDowngrade(getDb(), u.id, "pro")).toBe(true);
    clock = new Date("2026-02-28T00:00:00Z");
    await processDueRenewals(deps());
    expect(gateway.charges.map((c) => c.amount)).toEqual([59000, 9900]);
    expect(await sub(u.id)).toMatchObject({ plan: "pro", pendingPlan: null });
    const active = await getDb().select().from(automations).where(eq(automations.isActive, true));
    expect(active.map((a) => a.igAccountId)).toEqual([a1.id]);
  });

  it("never double-charges when the charge response is lost", async () => {
    const u = await createUser();
    gateway.issueKey("bk_1", u.id);
    await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" });
    gateway.nextCharge = (input) => {
      gateway.payments.set(input.paymentId, { status: "PAID", amount: input.amount, paidAt: new Date(), failureReason: null });
      return new Error("socket hang up");
    };
    clock = new Date("2026-02-28T00:00:00Z");
    await processDueRenewals(deps());
    expect((await sub(u.id)).currentPeriodEnd?.toISOString()).toBe("2026-02-27T16:00:00.000Z");
    gateway.nextCharge = null;
    await processDueRenewals(deps());
    expect(gateway.charges).toHaveLength(2);
    expect((await sub(u.id)).currentPeriodEnd?.toISOString()).toBe("2026-03-30T16:00:00.000Z");
  });

  describe("first payment whose response was lost", () => {
    function chargeThenLoseResponse() {
      gateway.nextCharge = (input) => {
        gateway.payments.set(input.paymentId, { status: "PAID", amount: input.amount, paidAt: clock, failureReason: null });
        return new Error("socket hang up");
      };
    }

    it("reports an unknown outcome and does not charge again when the user retries", async () => {
      const u = await createUser();
      gateway.issueKey("bk_1", u.id);
      chargeThenLoseResponse();
      const first = await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" });
      expect(first.ok).toBe(false);
      gateway.nextCharge = null;
      gateway.issueKey("bk_2", u.id);
      expect(await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_2" })).toEqual({ ok: true, charged: true });
      expect(gateway.charges).toHaveLength(1);
      expect(await sub(u.id)).toMatchObject({ plan: "pro", status: "active" });
      const rows = await getDb().select().from(payments);
      expect(rows.map((r) => r.status)).toEqual(["paid"]);
      clock = new Date("2026-02-27T16:05:00Z");
      await processDueRenewals(deps());
      expect(gateway.charges).toHaveLength(2);
      expect(gateway.deleted).not.toContain(gateway.charges[1].billingKey);
    });

    it("charges anew when the lost request never reached PortOne", async () => {
      const u = await createUser();
      gateway.issueKey("bk_1", u.id);
      gateway.nextCharge = () => new Error("ECONNRESET");
      expect((await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" })).ok).toBe(false);
      gateway.nextCharge = null;
      gateway.issueKey("bk_2", u.id);
      expect(await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_2" })).toEqual({ ok: true, charged: true });
      const rows = await getDb().select().from(payments).orderBy(payments.createdAt);
      expect(rows.map((r) => r.status).sort()).toEqual(["failed", "paid"]);
    });

    it("refuses to charge again while the earlier payment is still in flight", async () => {
      const u = await createUser();
      gateway.issueKey("bk_1", u.id);
      gateway.nextCharge = (input) => {
        gateway.payments.set(input.paymentId, { status: "READY", amount: input.amount, paidAt: null, failureReason: null });
        return new Error("timeout");
      };
      expect((await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" })).ok).toBe(false);
      gateway.nextCharge = null;
      gateway.issueKey("bk_2", u.id);
      expect((await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_2" })).ok).toBe(false);
      expect(gateway.charges).toHaveLength(1);
    });

    it("keeps the card when only the webhook activates the plan, so renewal still charges", async () => {
      const u = await createUser();
      gateway.issueKey("bk_1", u.id);
      chargeThenLoseResponse();
      await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" });
      gateway.nextCharge = null;
      const [pending] = await getDb().select().from(payments);
      await syncPayment(deps(), pending.paymentId);
      expect(await sub(u.id)).toMatchObject({ plan: "pro", status: "active" });
      clock = new Date("2026-02-27T16:05:00Z");
      await processDueRenewals(deps());
      expect(gateway.charges.at(-1)?.billingKey).toBe("bk_1");
      expect(await sub(u.id)).toMatchObject({ plan: "pro", status: "active" });
      expect(notices).toEqual([]);
    });
  });

  it("syncPayment activates a paid initial payment whose response was lost", async () => {
    const u = await createUser();
    const s = await setPlan(u.id, "free");
    await getDb().insert(payments).values({
      userId: u.id,
      subscriptionId: s.id,
      paymentId: "new_abc",
      plan: "pro",
      amount: 9900,
      periodStart: clock,
      periodEnd: new Date("2026-02-27T16:00:00Z"),
    });
    gateway.payments.set("new_abc", { status: "PAID", amount: 9900, paidAt: clock, failureReason: null });
    await syncPayment(deps(), "new_abc");
    expect(await sub(u.id)).toMatchObject({ plan: "pro", status: "active" });
    const [p] = await getDb().select().from(payments);
    expect(p.status).toBe("paid");
  });
});
