import { createHmac, timingSafeEqual } from "node:crypto";
import { parseJsonWithStringIds } from "./json";

export function parseSignedRequest(
  signedRequest: string,
  secrets: (string | undefined)[],
): { userId: string } | null {
  const [sigPart, payloadPart] = signedRequest.split(".");
  if (!sigPart || !payloadPart) return null;
  const given = Buffer.from(sigPart, "base64url");
  const valid = secrets.some((secret) => {
    if (!secret) return false;
    const expected = createHmac("sha256", secret).update(payloadPart).digest();
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
  if (!valid) return null;
  try {
    const data = parseJsonWithStringIds(Buffer.from(payloadPart, "base64url").toString("utf8")) as {
      algorithm?: string;
      user_id?: string | number;
    };
    if (data.algorithm && data.algorithm.toUpperCase() !== "HMAC-SHA256") return null;
    if (data.user_id === undefined || data.user_id === null) return null;
    return { userId: String(data.user_id) };
  } catch {
    return null;
  }
}

/** Meta 콜백 본문에서 signed_request를 꺼낸다. 폼이 아니거나 비어 있으면 빈 문자열(→ 400) */
export async function readSignedRequest(req: Request): Promise<string> {
  try {
    return String((await req.formData()).get("signed_request") ?? "");
  } catch {
    return "";
  }
}
