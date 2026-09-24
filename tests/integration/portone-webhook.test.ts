import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/portone/route";
import { setBillingGatewayForTesting } from "@/server/billing/gateway";
import { getDb } from "@/server/db/client";
import { payments } from "@/server/db/schema";
import { resetDb } from "../helpers/db";
import { createUser, setPlan } from "../helpers/factories";
import { FakeBillingGateway } from "../helpers/fake-billing";

function signed(body: string, secretB64 = process.env.PORTONE_WEBHOOK_SECRET ?? "") {
  const id = "msg_test_1";
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = createHmac("sha256", Buffer.from(secretB64, "base64")).update(`${id}.${ts}.${body}`).digest("base64");
  return new Request("http://localhost:3000/api/webhooks/portone", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` },
  });
}

describe("portone webhook", () => {
  let gateway: FakeBillingGateway;
  beforeEach(async () => {
    await resetDb();
    gateway = new FakeBillingGateway();
    setBillingGatewayForTesting(gateway);
  });
  afterEach(() => setBillingGatewayForTesting(null));

  it("rejects bad signatures", async () => {
    const res = await POST(signed("{}", Buffer.from("wrong").toString("base64")));
    expect(res.status).toBe(400);
  });

  it("re-fetches the payment and marks it paid", async () => {
    const u = await createUser();
    const s = await setPlan(u.id, "free");
    await getDb().insert(payments).values({
      userId: u.id, subscriptionId: s.id, paymentId: "new_abc", plan: "pro", amount: 9900,
      periodStart: new Date(), periodEnd: new Date(Date.now() + 30 * 86_400_000),
    });
    gateway.payments.set("new_abc", { status: "PAID", amount: 9900, paidAt: new Date(), failureReason: null });
    const body = JSON.stringify({
      type: "Transaction.Paid",
      timestamp: new Date().toISOString(),
      data: { storeId: "store-test", paymentId: "new_abc", transactionId: "tx_1" },
    });
    const res = await POST(signed(body));
    expect(res.status).toBe(200);
    const [p] = await getDb().select().from(payments);
    expect(p.status).toBe("paid");
  });

  it("acknowledges unknown event types", async () => {
    const body = JSON.stringify({ type: "Something.New", timestamp: new Date().toISOString(), data: {} });
    expect((await POST(signed(body))).status).toBe(200);
  });
});
