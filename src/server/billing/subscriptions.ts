import { and, asc, desc, eq, inArray, isNull, like, lt, lte, ne, or, sql } from "drizzle-orm";
import { isUpgrade, PLANS, type PaidPlanId, type PlanId } from "@/lib/plans";
import { site } from "@/lib/site";
import type { Db } from "@/server/db/client";
import { automations, igAccounts, payments, subscriptions, user, type Payment, type Subscription } from "@/server/db/schema";
import { errorFields, log } from "@/server/log";
import type { BillingGateway, RemotePayment } from "./gateway";
import { kstDateStamp, nextPeriodEnd } from "./periods";

export interface BillingDeps {
  db: Db;
  gateway: BillingGateway;
  now: () => Date;
  encrypt: (s: string) => string;
  decrypt: (s: string) => string;
  notify?: {
    paymentFailed(userId: string, planName: string, nextRetryAt: Date | null): Promise<void>;
    downgraded(userId: string, reason: "payment_failed" | "canceled"): Promise<void>;
  };
}

export type SubscribeResult = { ok: true; charged: boolean } | { ok: false; error: string };

const MAX_RENEWAL_ATTEMPTS = 3;
const RETRY_DELAY_MS = 86_400_000;
const LEASE_MS = 120_000;

const FIRST_PAYMENT_LIKE = "new\\_%";
const shortId = (id: string) => id.replace(/-/g, "").slice(0, 12);
const orderName = (plan: PlanId) => `${site.name} ${PLANS[plan].name} 월 구독`;

export function renewalPaymentId(subId: string, periodEnd: Date, attempt: number): string {
  return `sub_${shortId(subId)}_${kstDateStamp(periodEnd)}_${attempt}`;
}

export async function ensureSubscription(db: Db, userId: string): Promise<Subscription> {
  await db.insert(subscriptions).values({ userId }).onConflictDoNothing({ target: subscriptions.userId });
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  return row;
}

async function withLease<T>(db: Db, subId: string, now: Date, fn: () => Promise<T>): Promise<T | "locked"> {
  const got = await db
    .update(subscriptions)
    .set({ billingLockedUntil: new Date(now.getTime() + LEASE_MS) })
    .where(
      and(
        eq(subscriptions.id, subId),
        or(isNull(subscriptions.billingLockedUntil), lt(subscriptions.billingLockedUntil, now)),
      ),
    )
    .returning({ id: subscriptions.id });
  if (got.length === 0) return "locked";
  try {
    return await fn();
  } finally {
    await db.update(subscriptions).set({ billingLockedUntil: null }).where(eq(subscriptions.id, subId));
  }
}

async function safeDeleteKey(gateway: BillingGateway, billingKey: string): Promise<void> {
  try {
    await gateway.deleteBillingKey(billingKey);
  } catch (e) {
    log.error("billing key deletion failed", errorFields(e));
  }
}

export async function subscribe(
  deps: BillingDeps,
  p: {
    userId: string;
    email: string;
    plan: PaidPlanId;
    billingKey: string;
    customerName?: string | null;
    customerPhone?: string | null;
  },
): Promise<SubscribeResult> {
  const { db, gateway } = deps;
  const info = await gateway.getBillingKey(p.billingKey);
  if (!info || info.status !== "ISSUED" || info.customerId !== p.userId) {
    return { ok: false, error: "카드 정보를 확인할 수 없어요. 다시 등록해주세요" };
  }
  const base = await ensureSubscription(db, p.userId);
  const now = deps.now();

  const result = await withLease(db, base.id, now, async (): Promise<SubscribeResult> => {
    // 응답이 유실된 이전 첫 결제가 있으면 새로 청구하기 전에 결과부터 맞춘다(이중 청구 방지)
    const earlier = await reconcilePendingFirstPayments(deps, base.id);
    if (earlier === "in_flight") {
      await safeDeleteKey(gateway, p.billingKey);
      return { ok: false, error: "이전 결제를 확인하고 있어요. 잠시 후 다시 확인해주세요" };
    }
    const [current] = await db.select().from(subscriptions).where(eq(subscriptions.id, base.id));
    const paidActive = current.plan !== "free" && current.status !== "canceled";
    const name = p.customerName ?? info.customerName ?? current.customerName;
    const phone = p.customerPhone ?? info.customerPhone ?? current.customerPhone;
    const oldKey = current.billingKeyEnc ? deps.decrypt(current.billingKeyEnc) : null;

    if (paidActive && current.plan === p.plan) {
      await db
        .update(subscriptions)
        .set({ billingKeyEnc: deps.encrypt(p.billingKey), cardLabel: info.cardLabel, customerName: name, customerPhone: phone })
        .where(eq(subscriptions.id, current.id));
      if (oldKey && oldKey !== p.billingKey) await safeDeleteKey(gateway, oldKey);
      return { ok: true, charged: earlier === "paid" };
    }
    if (paidActive && !isUpgrade(current.plan, p.plan)) {
      await safeDeleteKey(gateway, p.billingKey);
      return { ok: false, error: "하위 플랜으로는 '다음 결제일부터 변경'을 이용해주세요" };
    }

    const periodEnd = nextPeriodEnd(now, now);
    // spec 7.8-2: (날짜, 시도 번호)로 결정적인 ID. 리스 안에서 세므로 겹치지 않는다
    const [{ tries }] = await db
      .select({ tries: sql<number>`count(*)::int` })
      .from(payments)
      .where(and(eq(payments.subscriptionId, current.id), like(payments.paymentId, FIRST_PAYMENT_LIKE)));
    const paymentId = `new_${shortId(current.id)}_${kstDateStamp(now)}_${tries}`;
    const amount = PLANS[p.plan].priceKrw;
    await db.insert(payments).values({
      userId: p.userId,
      subscriptionId: current.id,
      paymentId,
      plan: p.plan,
      amount,
      periodStart: now,
      periodEnd,
    });
    // 응답이 유실돼 웹훅으로만 활성화되더라도 갱신 결제를 할 수 있도록 청구 전에 카드를 저장한다
    await db
      .update(subscriptions)
      .set({ billingKeyEnc: deps.encrypt(p.billingKey), cardLabel: info.cardLabel, customerName: name, customerPhone: phone })
      .where(eq(subscriptions.id, current.id));
    let charge;
    try {
      charge = await gateway.charge({
        paymentId,
        billingKey: p.billingKey,
        orderName: orderName(p.plan),
        amount,
        customer: { id: p.userId, name, email: p.email, phone },
      });
    } catch (e) {
      log.error("first charge outcome unknown; reconciled by webhook or the next attempt", { paymentId, ...errorFields(e) });
      return { ok: false, error: "결제 결과를 확인하지 못했어요. 잠시 후 결제 화면에서 상태를 확인해주세요" };
    }
    if (charge.status === "failed") {
      await db.update(payments).set({ status: "failed", failureReason: charge.reason }).where(eq(payments.paymentId, paymentId));
      await db
        .update(subscriptions)
        .set({ billingKeyEnc: current.billingKeyEnc, cardLabel: current.cardLabel })
        .where(eq(subscriptions.id, current.id));
      await safeDeleteKey(gateway, p.billingKey);
      return { ok: false, error: `결제에 실패했어요: ${charge.reason}` };
    }
    await db.update(payments).set({ status: "paid", paidAt: charge.paidAt }).where(eq(payments.paymentId, paymentId));
    await db
      .update(subscriptions)
      .set({
        plan: p.plan,
        status: "active",
        billingKeyEnc: deps.encrypt(p.billingKey),
        cardLabel: info.cardLabel,
        customerName: name,
        customerPhone: phone,
        billingAnchorAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        pendingPlan: null,
        retryCount: 0,
        nextRetryAt: null,
      })
      .where(eq(subscriptions.id, current.id));
    if (oldKey && oldKey !== p.billingKey) await safeDeleteKey(gateway, oldKey);
    return { ok: true, charged: true };
  });

  return result === "locked" ? { ok: false, error: "결제가 진행 중이에요. 잠시 후 다시 시도해주세요" } : result;
}

export async function setCancelAtPeriodEnd(db: Db, userId: string, cancel: boolean): Promise<boolean> {
  const rows = await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: cancel })
    .where(and(eq(subscriptions.userId, userId), ne(subscriptions.plan, "free")))
    .returning({ id: subscriptions.id });
  return rows.length > 0;
}

export async function scheduleDowngrade(db: Db, userId: string, plan: "pro" | null): Promise<boolean> {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  if (!sub || sub.plan === "free") return false;
  if (plan && !isUpgrade(plan, sub.plan)) return false;
  await db.update(subscriptions).set({ pendingPlan: plan }).where(eq(subscriptions.id, sub.id));
  return true;
}

export async function applyPlanLimits(db: Db, userId: string, planId: PlanId): Promise<void> {
  const plan = PLANS[planId];
  const accounts = await db
    .select({ id: igAccounts.id })
    .from(igAccounts)
    .where(and(eq(igAccounts.userId, userId), ne(igAccounts.status, "disconnected")))
    .orderBy(asc(igAccounts.createdAt));
  const overflow = accounts.slice(plan.maxIgAccounts).map((a) => a.id);
  if (overflow.length > 0) {
    await db.update(automations).set({ isActive: false }).where(inArray(automations.igAccountId, overflow));
  }
  if (plan.maxActiveAutomations !== null) {
    const active = await db
      .select({ id: automations.id })
      .from(automations)
      .where(and(eq(automations.userId, userId), eq(automations.isActive, true)))
      .orderBy(desc(automations.updatedAt));
    const extra = active.slice(plan.maxActiveAutomations).map((a) => a.id);
    if (extra.length > 0) await db.update(automations).set({ isActive: false }).where(inArray(automations.id, extra));
  }
}

async function downgradeToFree(deps: BillingDeps, sub: Subscription, reason: "payment_failed" | "canceled"): Promise<void> {
  if (sub.billingKeyEnc) await safeDeleteKey(deps.gateway, deps.decrypt(sub.billingKeyEnc));
  await deps.db
    .update(subscriptions)
    .set({
      plan: "free",
      status: "active",
      billingKeyEnc: null,
      cardLabel: null,
      billingAnchorAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      pendingPlan: null,
      retryCount: 0,
      nextRetryAt: null,
    })
    .where(eq(subscriptions.id, sub.id));
  await applyPlanLimits(deps.db, sub.userId, "free");
  await deps.notify?.downgraded(sub.userId, reason);
}

async function renewOne(deps: BillingDeps, subId: string): Promise<void> {
  const { db } = deps;
  const now = deps.now();
  await withLease(db, subId, now, async () => {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, subId));
    if (!sub || sub.plan === "free" || !sub.currentPeriodEnd) return;
    const due =
      (sub.status === "active" && sub.currentPeriodEnd <= now) ||
      (sub.status === "past_due" && sub.nextRetryAt !== null && sub.nextRetryAt <= now);
    if (!due) return;
    if (sub.cancelAtPeriodEnd || !sub.billingKeyEnc) {
      await downgradeToFree(deps, sub, "canceled");
      return;
    }

    const plan = sub.pendingPlan ?? sub.plan;
    const [owner] = await db.select({ email: user.email }).from(user).where(eq(user.id, sub.userId));
    const periodStart = sub.currentPeriodEnd;
    const periodEnd = nextPeriodEnd(sub.billingAnchorAt ?? periodStart, periodStart);
    const paymentId = renewalPaymentId(sub.id, periodStart, sub.retryCount);
    await db
      .insert(payments)
      .values({ userId: sub.userId, subscriptionId: sub.id, paymentId, plan, amount: PLANS[plan].priceKrw, periodStart, periodEnd })
      .onConflictDoNothing({ target: payments.paymentId });

    let result;
    try {
      result = await deps.gateway.charge({
        paymentId,
        billingKey: deps.decrypt(sub.billingKeyEnc),
        orderName: orderName(plan),
        amount: PLANS[plan].priceKrw,
        customer: { id: sub.userId, name: sub.customerName, email: owner?.email ?? null, phone: sub.customerPhone },
      });
    } catch (e) {
      log.error("renewal charge outcome unknown; will retry with the same paymentId", { subscriptionId: sub.id, ...errorFields(e) });
      return;
    }

    if (result.status === "paid") {
      await db.update(payments).set({ status: "paid", paidAt: result.paidAt }).where(eq(payments.paymentId, paymentId));
      await db
        .update(subscriptions)
        .set({ plan, pendingPlan: null, status: "active", currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, retryCount: 0, nextRetryAt: null })
        .where(eq(subscriptions.id, sub.id));
      if (plan !== sub.plan) await applyPlanLimits(db, sub.userId, plan);
      return;
    }

    await db.update(payments).set({ status: "failed", failureReason: result.reason }).where(eq(payments.paymentId, paymentId));
    const attempts = sub.retryCount + 1;
    if (attempts >= MAX_RENEWAL_ATTEMPTS) {
      await downgradeToFree(deps, sub, "payment_failed");
      return;
    }
    const nextRetryAt = new Date(now.getTime() + RETRY_DELAY_MS);
    await db
      .update(subscriptions)
      .set({ status: "past_due", retryCount: attempts, nextRetryAt })
      .where(eq(subscriptions.id, sub.id));
    await deps.notify?.paymentFailed(sub.userId, PLANS[plan].name, nextRetryAt);
  });
}

export async function processDueRenewals(deps: BillingDeps): Promise<number> {
  const now = deps.now();
  const due = await deps.db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        ne(subscriptions.plan, "free"),
        or(
          and(eq(subscriptions.status, "active"), lte(subscriptions.currentPeriodEnd, now)),
          and(eq(subscriptions.status, "past_due"), lte(subscriptions.nextRetryAt, now)),
        ),
      ),
    )
    .limit(100);
  for (const { id } of due) {
    try {
      await renewOne(deps, id);
    } catch (e) {
      log.error("renewal failed", { subscriptionId: id, ...errorFields(e) });
    }
  }
  return due.length;
}

const SETTLED_REMOTE = new Set(["PAID", "FAILED", "CANCELLED", "PARTIAL_CANCELLED"]);

async function reconcilePendingFirstPayments(deps: BillingDeps, subId: string): Promise<"none" | "paid" | "in_flight"> {
  const pending = await deps.db
    .select()
    .from(payments)
    .where(and(eq(payments.subscriptionId, subId), eq(payments.status, "pending"), like(payments.paymentId, FIRST_PAYMENT_LIKE)));
  let outcome: "none" | "paid" | "in_flight" = "none";
  for (const row of pending) {
    const remote = await deps.gateway.getPayment(row.paymentId);
    if (!remote) {
      // 포트원에 도달하지 못한 요청이다
      await deps.db.update(payments).set({ status: "failed", failureReason: "결제 요청이 전달되지 않았어요" }).where(eq(payments.id, row.id));
      continue;
    }
    await applyRemotePayment(deps, row, remote);
    if (remote.status === "PAID") outcome = "paid";
    else if (!SETTLED_REMOTE.has(remote.status) && outcome === "none") outcome = "in_flight";
  }
  return outcome;
}

export async function syncPayment(deps: BillingDeps, paymentId: string): Promise<void> {
  const [row] = await deps.db.select().from(payments).where(eq(payments.paymentId, paymentId));
  if (!row) return;
  const remote = await deps.gateway.getPayment(paymentId);
  if (!remote) return;
  await applyRemotePayment(deps, row, remote);
}

async function applyRemotePayment(deps: BillingDeps, row: Payment, remote: RemotePayment): Promise<void> {
  const { db } = deps;
  if (remote.status === "PAID" && row.status !== "paid") {
    if (remote.amount !== row.amount) {
      log.error("payment amount mismatch", { paymentId: row.paymentId });
      return;
    }
    await db.update(payments).set({ status: "paid", paidAt: remote.paidAt ?? deps.now() }).where(eq(payments.id, row.id));
    if (row.subscriptionId && row.periodEnd) {
      await db
        .update(subscriptions)
        .set({
          plan: row.plan,
          status: "active",
          currentPeriodStart: row.periodStart,
          currentPeriodEnd: row.periodEnd,
          billingAnchorAt: sql`coalesce(${subscriptions.billingAnchorAt}, ${row.periodStart?.toISOString() ?? null}::timestamptz)`,
          retryCount: 0,
          nextRetryAt: null,
        })
        .where(
          and(
            eq(subscriptions.id, row.subscriptionId),
            or(isNull(subscriptions.currentPeriodEnd), lt(subscriptions.currentPeriodEnd, row.periodEnd)),
          ),
        );
    }
  } else if (remote.status === "FAILED" && row.status === "pending") {
    await db.update(payments).set({ status: "failed", failureReason: remote.failureReason }).where(eq(payments.id, row.id));
  } else if ((remote.status === "CANCELLED" || remote.status === "PARTIAL_CANCELLED") && row.status !== "canceled") {
    await db.update(payments).set({ status: "canceled" }).where(eq(payments.id, row.id));
  }
}
