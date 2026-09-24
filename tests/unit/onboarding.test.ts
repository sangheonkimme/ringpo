import { describe, expect, it } from "vitest";
import { setupProgress } from "@/lib/onboarding";

const base = { connected: false, professional: false, messageAccess: false, hasAutomation: false };

describe("setupProgress", () => {
  it("starts on the Instagram settings checklist with connect up next", () => {
    expect(setupProgress(base)).toMatchObject({ ready: false, steps: ["current", "upcoming", "locked"], doneCount: 0 });
  });

  it("moves to connecting once both settings are checked", () => {
    expect(setupProgress({ ...base, professional: true, messageAccess: true })).toMatchObject({
      ready: true,
      steps: ["done", "current", "locked"],
      doneCount: 1,
    });
  });

  it("treats a connected account as professional but still asks about message access", () => {
    expect(setupProgress({ ...base, connected: true })).toMatchObject({
      professional: true,
      ready: false,
      steps: ["current", "done", "current"],
      doneCount: 1,
    });
  });

  it("is complete after connecting with message access and a first automation", () => {
    expect(setupProgress({ connected: true, professional: false, messageAccess: true, hasAutomation: true })).toMatchObject({
      steps: ["done", "done", "done"],
      doneCount: 3,
    });
  });
});
