import { describe, expect, it } from "vitest";
import { automationStatus, SCOPE_LABEL } from "@/lib/automation-status";

describe("automationStatus", () => {
  it("shows a running automation as 실행 중", () => {
    expect(automationStatus({ isActive: true, mediaScope: "all", accountStatus: "active" })).toEqual({ label: "실행 중", tone: "success" });
    expect(automationStatus({ isActive: true, mediaScope: "specific", accountStatus: "active" })).toEqual({ label: "실행 중", tone: "success" });
  });

  it("shows a switched-on next-post automation that has no post yet as 게시물 대기", () => {
    expect(automationStatus({ isActive: true, mediaScope: "next", accountStatus: "active" })).toEqual({ label: "게시물 대기", tone: "success" });
  });

  it("shows a switched-off automation as 일시중지, even when it targets the next post", () => {
    expect(automationStatus({ isActive: false, mediaScope: "next", accountStatus: "active" })).toEqual({ label: "일시중지", tone: "neutral" });
    expect(automationStatus({ isActive: false, mediaScope: "all", accountStatus: "active" })).toEqual({ label: "일시중지", tone: "neutral" });
  });

  it("asks for attention when a switched-on automation's Instagram connection is broken", () => {
    expect(automationStatus({ isActive: true, mediaScope: "all", accountStatus: "reauth_required" })).toEqual({ label: "확인 필요", tone: "danger" });
    expect(automationStatus({ isActive: true, mediaScope: "next", accountStatus: "disconnected" })).toEqual({ label: "확인 필요", tone: "danger" });
  });

  it("keeps a switched-off automation as 일시중지 when the connection is broken", () => {
    expect(automationStatus({ isActive: false, mediaScope: "all", accountStatus: "reauth_required" })).toEqual({ label: "일시중지", tone: "neutral" });
  });
});

describe("SCOPE_LABEL", () => {
  it("names the target posts without mixing in run state", () => {
    expect(SCOPE_LABEL).toEqual({ specific: "특정 게시물", all: "모든 게시물", next: "다음 게시물" });
  });
});
