import type {
  BillingGateway,
  BillingKeyInfo,
  ChargeInput,
  ChargeResult,
  RemotePayment,
} from "@/server/billing/gateway";

export class FakeBillingGateway implements BillingGateway {
  keys = new Map<string, BillingKeyInfo>();
  payments = new Map<string, RemotePayment>();
  charges: ChargeInput[] = [];
  deleted: string[] = [];
  nextCharge: ((input: ChargeInput) => ChargeResult | Error) | null = null;

  issueKey(billingKey: string, customerId: string, extra: Partial<BillingKeyInfo> = {}) {
    this.keys.set(billingKey, {
      status: "ISSUED",
      customerId,
      customerName: "홍길동",
      customerPhone: "01012345678",
      cardLabel: "신한카드 **** 1234",
      ...extra,
    });
  }

  async getBillingKey(billingKey: string) {
    return this.keys.get(billingKey) ?? null;
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const existing = this.payments.get(input.paymentId);
    if (existing?.status === "PAID") return { status: "paid", paidAt: existing.paidAt ?? new Date() };
    this.charges.push(input);
    const r = this.nextCharge?.(input) ?? { status: "paid" as const, paidAt: new Date() };
    if (r instanceof Error) throw r;
    this.payments.set(input.paymentId, {
      status: r.status === "paid" ? "PAID" : "FAILED",
      amount: input.amount,
      paidAt: r.status === "paid" ? r.paidAt : null,
      failureReason: r.status === "failed" ? r.reason : null,
    });
    return r;
  }

  async getPayment(paymentId: string) {
    return this.payments.get(paymentId) ?? null;
  }

  async deleteBillingKey(billingKey: string) {
    this.deleted.push(billingKey);
    const info = this.keys.get(billingKey);
    if (info) this.keys.set(billingKey, { ...info, status: "DELETED" });
  }
}
