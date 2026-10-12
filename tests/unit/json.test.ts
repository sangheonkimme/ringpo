import { describe, expect, it } from "vitest";
import { parseJsonWithStringIds } from "@/server/instagram/json";

describe("parseJsonWithStringIds", () => {
  it("keeps large numeric ids exact as strings", () => {
    const parsed = parseJsonWithStringIds('{"user_id": 17841400000000001, "id": 12}') as Record<string, unknown>;
    expect(parsed.user_id).toBe("17841400000000001");
    expect(parsed.id).toBe(12);
  });

  it("does not touch ids inside string values", () => {
    const parsed = parseJsonWithStringIds('{"text":"\\"id\\": 17841400000000001"}') as { text: string };
    expect(parsed.text).toBe('"id": 17841400000000001');
  });

  it("converts nested recipient ids", () => {
    const parsed = parseJsonWithStringIds('{"recipient_id": 5261234567890123456}') as { recipient_id: string };
    expect(parsed.recipient_id).toBe("5261234567890123456");
  });
});
