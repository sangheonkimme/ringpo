export class GraphApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code?: number,
    readonly subcode?: number,
  ) {
    super(message);
    this.name = "GraphApiError";
  }
}

export class GraphNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphNetworkError";
  }
}

export type ErrorClass = "rate_limited" | "transient" | "auth" | "invalid_message" | "permanent";

export interface ClassifiedError {
  cls: ErrorClass;
  code: string;
  message: string;
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80002]);

export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof GraphApiError) {
    const code =
      err.code === undefined ? `http_${err.httpStatus}` : err.subcode ? `${err.code}/${err.subcode}` : String(err.code);
    const message = err.message;
    if ((err.code !== undefined && RATE_LIMIT_CODES.has(err.code)) || err.httpStatus === 429) {
      return { cls: "rate_limited", code, message };
    }
    if (err.code === 190) return { cls: "auth", code, message };
    if (err.code === 100 && err.subcode === 2534015) return { cls: "invalid_message", code, message };
    if (err.httpStatus >= 500 || err.code === 1 || err.code === 2) return { cls: "transient", code, message };
    return { cls: "permanent", code, message };
  }
  if (err instanceof GraphNetworkError) return { cls: "transient", code: "network", message: err.message };
  return { cls: "transient", code: "unknown", message: err instanceof Error ? err.message : String(err) };
}

const REASONS: Record<string, string> = {
  "10/2534022": "발송 가능 시간이 지났어요 (댓글 후 7일)",
  "10/2018278": "발송 가능 시간이 지났어요",
  "100/2534025": "이미 답장했거나 삭제된 댓글이에요",
  "100/2534014": "댓글 작성자를 찾을 수 없어요",
  "100/2534015": "메시지 형식이 거부됐어요",
  "551": "상대방이 지금 메시지를 받을 수 없어요",
  "551/1545041": "상대방이 지금 메시지를 받을 수 없어요",
  "200/2534041": "인스타 계정에서 DM 접근이 꺼져 있어요",
  "190": "인스타 연결이 만료됐어요. 다시 연결해주세요",
  network: "일시적인 네트워크 오류",
  expired: "7일 안에 발송하지 못했어요",
};

export function errorReasonKo(code: string | null): string {
  if (!code) return "";
  const known = REASONS[code];
  if (known) return known;
  const base = code.split("/")[0];
  if (["4", "17", "32", "613", "80002", "http_429"].includes(base)) {
    return "인스타그램 발송 한도에 걸려 잠시 후 재시도해요";
  }
  if (base === "10" || base === "200") return "권한이 부족해요. 인스타 연결을 확인해주세요";
  return `인스타그램 오류 (${code})`;
}
