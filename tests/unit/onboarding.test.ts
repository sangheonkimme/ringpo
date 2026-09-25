import { describe, expect, it } from "vitest";
import { setupProgress } from "@/lib/onboarding";

const base = { connected: false, dmBlocked: false, hasAutomation: false };

describe("setupProgress", () => {
  it("starts with connecting Instagram, since Instagram itself offers the professional switch", () => {
    expect(setupProgress(base)).toEqual({ steps: ["current", "upcoming", "locked"], doneCount: 0 });
  });

  it("marks message access done on connect, because the consent screen turns it on", () => {
    expect(setupProgress({ ...base, connected: true })).toEqual({ steps: ["done", "done", "current"], doneCount: 2 });
  });

  it("reopens message access when a DM was blocked because it is off", () => {
    expect(setupProgress({ ...base, connected: true, dmBlocked: true })).toEqual({ steps: ["done", "current", "upcoming"], doneCount: 1 });
  });

  it("is complete after connecting and creating a first automation", () => {
    expect(setupProgress({ connected: true, dmBlocked: false, hasAutomation: true })).toEqual({ steps: ["done", "done", "done"], doneCount: 3 });
  });
});
