import { PortOneClient } from "@portone/server-sdk";
import { getEnv } from "@/server/env";

export interface BillingKeyInfo {
  status: "ISSUED" | "DELETED";
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  cardLabel: string | null;
}

export interface ChargeInput {
  paymentId: string;
  billingKey: string;
  orderName: string;
  amount: number;
  customer: { id: string; name: string | null; email: string | null; phone: string | null };
}

export type ChargeResult = { status: "paid"; paidAt: Date } | { status: "failed"; reason: string };

export interface RemotePayment {
  status: string;
  amount: number;
  paidAt: Date | null;
  failureReason: string | null;
}

export interface BillingGateway {
  getBillingKey(billingKey: string): Promise<BillingKeyInfo | null>;
  /** 결과를 알 수 없는 오류(네트워크·인증 설정)는 throw 한다. */
  charge(input: ChargeInput): Promise<ChargeResult>;
  getPayment(paymentId: string): Promise<RemotePayment | null>;
  deleteBillingKey(billingKey: string): Promise<void>;
}

interface SdkErrorShape {
  data?: { type?: string; message?: string; pgMessage?: string };
  message?: string;
}

const errType = (e: unknown) => (e as SdkErrorShape | undefined)?.data?.type;
const CONFIG_ERRORS = new Set(["UNAUTHORIZED", "FORBIDDEN", "INVALID_REQUEST", "CHANNEL_NOT_FOUND"]);

export function createPortOneGateway(secret: string): BillingGateway {
  const client = PortOneClient({ secret });

  const gateway: BillingGateway = {
    async getBillingKey(billingKey) {
      try {
        const info = (await client.payment.billingKey.getBillingKeyInfo({ billingKey })) as unknown as {
          status: string;
          customer?: { id?: string; name?: { full?: string }; phoneNumber?: string };
          methods?: { card?: { name?: string; issuer?: string; number?: string } }[];
        };
        const card = info.methods?.[0]?.card;
        const label = card ? [card.name ?? card.issuer, card.number ? `**** ${card.number.slice(-4)}` : null].filter(Boolean).join(" ") : "";
        return {
          status: info.status === "DELETED" ? "DELETED" : "ISSUED",
          customerId: info.customer?.id ?? null,
          customerName: info.customer?.name?.full ?? null,
          customerPhone: info.customer?.phoneNumber ?? null,
          cardLabel: label || null,
        };
      } catch (e) {
        if (errType(e) === "BILLING_KEY_NOT_FOUND") return null;
        throw e;
      }
    },

    async charge(input) {
      try {
        const res = (await client.payment.payWithBillingKey({
          paymentId: input.paymentId,
          billingKey: input.billingKey,
          orderName: input.orderName,
          customer: {
            id: input.customer.id,
            ...(input.customer.name ? { name: { full: input.customer.name } } : {}),
            ...(input.customer.email ? { email: input.customer.email } : {}),
            ...(input.customer.phone ? { phoneNumber: input.customer.phone } : {}),
          },
          amount: { total: input.amount },
          currency: "KRW",
        })) as unknown as { payment?: { paidAt?: string } };
        return { status: "paid", paidAt: res.payment?.paidAt ? new Date(res.payment.paidAt) : new Date() };
      } catch (e) {
        const type = errType(e);
        if (type === "ALREADY_PAID") {
          const p = await gateway.getPayment(input.paymentId);
          if (p?.status === "PAID") return { status: "paid", paidAt: p.paidAt ?? new Date() };
        }
        if (type && !CONFIG_ERRORS.has(type)) {
          const d = (e as SdkErrorShape).data;
          return { status: "failed", reason: d?.pgMessage ?? d?.message ?? type };
        }
        throw e;
      }
    },

    async getPayment(paymentId) {
      try {
        const p = (await client.payment.getPayment({ paymentId })) as unknown as {
          status: string;
          amount?: { total?: number };
          paidAt?: string;
          failure?: { reason?: string; pgMessage?: string };
        };
        return {
          status: p.status,
          amount: p.amount?.total ?? 0,
          paidAt: p.paidAt ? new Date(p.paidAt) : null,
          failureReason: p.failure?.pgMessage ?? p.failure?.reason ?? null,
        };
      } catch (e) {
        if (errType(e) === "PAYMENT_NOT_FOUND") return null;
        throw e;
      }
    },

    async deleteBillingKey(billingKey) {
      try {
        await client.payment.billingKey.deleteBillingKey({ billingKey });
      } catch (e) {
        const t = errType(e);
        if (t === "BILLING_KEY_NOT_FOUND" || t === "BILLING_KEY_ALREADY_DELETED") return;
        throw e;
      }
    },
  };
  return gateway;
}

let override: BillingGateway | null = null;
let instance: BillingGateway | null = null;

export function billingConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.PORTONE_API_SECRET && env.PORTONE_STORE_ID && env.PORTONE_CHANNEL_KEY);
}

export function getBillingGateway(): BillingGateway {
  if (override) return override;
  const secret = getEnv().PORTONE_API_SECRET;
  if (!secret) throw new Error("PORTONE_API_SECRET is not configured");
  instance ??= createPortOneGateway(secret);
  return instance;
}

export function setBillingGatewayForTesting(g: BillingGateway | null): void {
  override = g;
}
