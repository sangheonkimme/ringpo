import { describe, expect, it } from "vitest";
import { setupProgress } from "@/lib/onboarding";

const base = { connected: false, messageAccess: false, hasAutomation: false };

describe("setupProgress", () => {
  it("starts with connecting Instagram, since Instagram itself offers the professional switch", () => {
    expect(setupProgress(base)).toEqual({ steps: ["current", "upcoming", "locked"], doneCount: 0 });
  });

  it("asks for message access right after connecting", () => {
    expect(setupProgress({ ...base, connected: true })).toEqual({ steps: ["done", "current", "upcoming"], doneCount: 1 });
  });

  it("moves to the first automation once message access is checked", () => {
    expect(setupProgress({ ...base, connected: true, messageAccess: true })).toEqual({ steps: ["done", "done", "current"], doneCount: 2 });
  });

  it("keeps message access checked even before connecting, but automation stays locked", () => {
    expect(setupProgress({ ...base, messageAccess: true })).toEqual({ steps: ["current", "done", "locked"], doneCount: 1 });
  });

  it("is complete after connecting with message access and a first automation", () => {
    expect(setupProgress({ connected: true, messageAccess: true, hasAutomation: true })).toEqual({ steps: ["done", "done", "done"], doneCount: 3 });
  });
});
