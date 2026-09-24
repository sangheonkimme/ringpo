import { decryptSecret, encryptSecret } from "@/server/crypto";
import type { Db } from "@/server/db/client";
import { emails } from "@/server/emails";
import { notifyUser } from "@/server/notifications";
import { getBillingGateway } from "./gateway";
import type { BillingDeps } from "./subscriptions";

export function createBillingDeps(db: Db): BillingDeps {
  return {
    db,
    gateway: getBillingGateway(),
    now: () => new Date(),
    encrypt: encryptSecret,
    decrypt: decryptSecret,
    notify: {
      paymentFailed: (userId, planName, nextRetryAt) => notifyUser(db, userId, emails.paymentFailed(planName, nextRetryAt)),
      downgraded: (userId, reason) => notifyUser(db, userId, emails.downgraded(reason)),
    },
  };
}
