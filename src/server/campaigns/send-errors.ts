import { GraphApiError, GraphNetworkError } from "@/server/instagram/errors";

export interface SendFailure {
  state: "retry" | "failed" | "expired" | "unknown";
  code: string;
  protection: "rate" | "policy" | "auth" | null;
  retryAfterMs?: number;
}

/** Reads may be retried; ambiguous WRITES deliberately have a stricter policy. */
export function classifyCampaignSendError(error: unknown): SendFailure {
  if (error instanceof GraphNetworkError) return { state: "unknown", code: "network", protection: null };
  if (!(error instanceof GraphApiError)) return { state: "unknown", code: "unknown", protection: null };
  const code = error.code === undefined ? `http_${error.httpStatus}` : `${error.code}${error.subcode ? `/${error.subcode}` : ""}`;
  if (error.httpStatus >= 500 || [1, 2].includes(error.code ?? -1)) return { state: "unknown", code, protection: null };
  if ([4, 17, 32, 613, 80002].includes(error.code ?? -1) || error.httpStatus === 429) return { state: "retry", code, protection: "rate", retryAfterMs: error.retryAfterMs };
  if (error.code === 190 || (error.code === 200 && error.subcode === 2534041)) return { state: "failed", code, protection: "auth" };
  if (error.code === 100 && error.subcode === 2534029) return { state: "failed", code, protection: "policy" };
  if (error.code === 10 && [2534022, 2018278].includes(error.subcode ?? -1)) return { state: "expired", code, protection: null };
  return { state: "failed", code, protection: null };
}
