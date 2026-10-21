import { performance } from "node:perf_hooks";
import type { GraphReplyResult, GraphSendResult } from "@/server/instagram/graph";
import type { GraphRateHint } from "@/server/instagram/rate-hints";
import { classifyCampaignSendError, type SendFailure } from "./send-errors";

export type BudgetedWriteResult =
  | { state: "accepted"; providerMessageId: string; rateHint?: GraphRateHint; invokedAt: Date }
  | { state: "not_invoked"; code: string }
  | { state: "error"; failure: SendFailure; invokedAt: Date };

/** All guarded write paths use the same monotonic permit and conservative uncertainty policy. */
export async function invokeBudgetedWrite(
  permit: { startedAt: Date; monotonicStartedAt: number; validForMs: number; deadlineAt: Date },
  send: () => Promise<GraphReplyResult | GraphSendResult>,
): Promise<BudgetedWriteResult> {
  const elapsed = Math.max(0, performance.now() - permit.monotonicStartedAt);
  if (elapsed >= permit.validForMs) return { state: "not_invoked", code: "send_permit_elapsed" };
  const invokedAt = new Date(permit.startedAt.getTime() + Math.ceil(elapsed));
  if (invokedAt >= permit.deadlineAt) return { state: "not_invoked", code: "deadline_before_call" };
  try {
    const result = await send();
    const id = "messageId" in result ? result.messageId : result.id;
    if (typeof id !== "string" || !id.trim() || ["undefined", "null"].includes(id)) {
      return { state: "error", invokedAt, failure: { state: "unknown", code: "missing_provider_id", protection: null } };
    }
    return { state: "accepted", providerMessageId: id, rateHint: result.rateHint, invokedAt };
  } catch (error) { return { state: "error", invokedAt, failure: classifyCampaignSendError(error) }; }
}
