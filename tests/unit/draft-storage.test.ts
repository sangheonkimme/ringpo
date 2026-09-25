import { describe, expect, it } from "vitest";
import { draftKey, parseStoredDraft, serializeDraft } from "@/lib/draft-storage";

const now = new Date("2026-09-25T03:00:00Z");
const draft = { name: "날씨 자동화", keywords: ["날씨"], media: { id: "m1", caption: "날씨가 춥네요" } };

describe("draft storage", () => {
  it("keys drafts by automation, with one slot for new automations", () => {
    expect(draftKey(undefined)).toBe("ringpo:automation-draft:new");
    expect(draftKey("abc")).toBe("ringpo:automation-draft:abc");
  });

  it("restores the draft and the step it was on", () => {
    const raw = serializeDraft(draft, 4, now);
    expect(parseStoredDraft(raw, new Date(now.getTime() + 60_000))).toEqual({ draft, step: 4 });
  });

  it("ignores drafts older than a day, broken JSON and missing values", () => {
    const raw = serializeDraft(draft, 2, now);
    expect(parseStoredDraft(raw, new Date(now.getTime() + 25 * 3_600_000))).toBeNull();
    expect(parseStoredDraft("{not json", now)).toBeNull();
    expect(parseStoredDraft(null, now)).toBeNull();
    expect(parseStoredDraft(JSON.stringify({ step: 1, savedAt: now.getTime() }), now)).toBeNull();
  });
});
