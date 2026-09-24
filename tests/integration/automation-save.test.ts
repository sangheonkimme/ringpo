import { beforeEach, describe, expect, it } from "vitest";
import type { AutomationInput } from "@/lib/automation-schema";
import { createAutomation, getAutomation, updateAutomation } from "@/server/automations/service";
import { getDb } from "@/server/db/client";
import { resetDb } from "../helpers/db";
import { createAutomation as seedAutomation, createIgAccount, createUser } from "../helpers/factories";

const opts = { appUrl: "https://app.test", activate: true };

function input(igAccountId: string, overrides: Partial<AutomationInput> = {}): AutomationInput {
  return {
    igAccountId,
    name: "공구",
    mediaScope: "specific",
    media: { id: "m1", thumbnailUrl: "https://t", permalink: "https://p", caption: "캡션" },
    keywords: ["공구", " 공구 ", "링크"],
    matchType: "contains",
    replyEnabled: true,
    replyTexts: ["DM 확인!"],
    dmText: "링크",
    dmButtonTitle: "구매",
    dmLinkUrl: "https://shop.example.com",
    ...overrides,
  };
}

describe("create/update automation", () => {
  beforeEach(resetDb);

  it("creates an active automation with deduped keywords and media fields", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const res = await createAutomation(getDb(), u.id, input(acct.id), opts);
    expect(res).toMatchObject({ ok: true, activated: true });
    if (!res.ok) throw new Error("unreachable");
    const row = await getAutomation(getDb(), u.id, res.id);
    expect(row).toMatchObject({ keywords: ["공구", "링크"], mediaId: "m1", mediaPermalink: "https://p", isActive: true });
  });

  it("saves but does not activate beyond the free plan limit", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await seedAutomation(acct, { isActive: true });
    const res = await createAutomation(getDb(), u.id, input(acct.id), opts);
    expect(res).toMatchObject({ ok: true, activated: false, activationError: "limit" });
  });

  it("rejects another user's account and self short links", async () => {
    const owner = await createUser();
    const acct = await createIgAccount(owner.id);
    const intruder = await createUser();
    expect((await createAutomation(getDb(), intruder.id, input(acct.id), opts)).ok).toBe(false);
    const res = await createAutomation(getDb(), owner.id, input(acct.id, { dmLinkUrl: "https://app.test/l/abc1234" }), opts);
    expect(res).toEqual({ ok: false, error: "이 서비스의 단축 링크는 넣을 수 없어요" });
  });

  it("updates fields and clears media when switching to all posts", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const created = await createAutomation(getDb(), u.id, input(acct.id), opts);
    if (!created.ok) throw new Error("unreachable");
    const res = await updateAutomation(getDb(), u.id, created.id, input(acct.id, { mediaScope: "all", media: null, name: "전체" }), { ...opts, activate: false });
    expect(res.ok).toBe(true);
    const row = await getAutomation(getDb(), u.id, created.id);
    expect(row).toMatchObject({ name: "전체", mediaScope: "all", mediaId: null, isActive: false });
  });
});
