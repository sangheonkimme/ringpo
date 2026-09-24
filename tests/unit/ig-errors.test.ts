import { describe, expect, it } from "vitest";
import { classifyError, errorReasonKo, GraphApiError, GraphNetworkError } from "@/server/instagram/errors";

const err = (status: number, code?: number, subcode?: number) => new GraphApiError("x", status, code, subcode);

describe("classifyError", () => {
  it.each([
    [err(400, 613, 2534040), "rate_limited", "613/2534040"],
    [err(400, 4), "rate_limited", "4"],
    [err(429), "rate_limited", "http_429"],
    [err(500, 2), "transient", "2"],
    [err(503), "transient", "http_503"],
    [err(400, 190), "auth", "190"],
    [err(400, 100, 2534015), "invalid_message", "100/2534015"],
    [err(400, 10, 2534022), "permanent", "10/2534022"],
    [err(400, 551), "permanent", "551"],
    [err(400, 200, 2534041), "permanent", "200/2534041"],
  ])("classifies %o as %s", (e, cls, code) => {
    expect(classifyError(e)).toMatchObject({ cls, code });
  });
  it("treats network and unknown errors as transient", () => {
    expect(classifyError(new GraphNetworkError("timeout")).cls).toBe("transient");
    expect(classifyError(new Error("boom")).cls).toBe("transient");
  });
});

describe("errorReasonKo", () => {
  it("maps known codes to Korean reasons", () => {
    expect(errorReasonKo("551")).toContain("메시지를 받을 수 없어요");
    expect(errorReasonKo("613/2534040")).toContain("한도");
    expect(errorReasonKo("190")).toContain("다시 연결");
    expect(errorReasonKo(null)).toBe("");
    expect(errorReasonKo("999")).toBe("인스타그램 오류 (999)");
  });
  it("points to the Instagram setting when message access is off or permissions are missing", () => {
    expect(errorReasonKo("200/2534041")).toContain("메시지 접근 허용");
    expect(errorReasonKo("10")).toContain("메시지 접근 허용");
    expect(errorReasonKo("200")).toContain("메시지 접근 허용");
  });
});
