import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { links } from "@/server/db/schema";
import { getOrCreateEventLink, resolveLinkClick } from "@/server/links";
import { resetDb } from "../helpers/db";
import { createAutomation, createEvent, createIgAccount, createUser } from "../helpers/factories";

describe("links", () => {
  beforeEach(resetDb);

  it("creates one link per event and counts human clicks only", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const auto = await createAutomation(acct);
    const ev = await createEvent(acct);
    const code = await getOrCreateEventLink(getDb(), { eventId: ev.id, automationId: auto.id, targetUrl: "https://shop.example.com/p/1" });
    expect(await getOrCreateEventLink(getDb(), { eventId: ev.id, automationId: auto.id, targetUrl: "https://other" })).toBe(code);

    const now = new Date();
    expect(await resolveLinkClick(getDb(), code, { countClick: false, now })).toBe("https://shop.example.com/p/1");
    expect(await resolveLinkClick(getDb(), code, { countClick: true, now })).toBe("https://shop.example.com/p/1");
    await resolveLinkClick(getDb(), code, { countClick: true, now: new Date(now.getTime() + 1000) });
    const [row] = await getDb().select().from(links).where(eq(links.code, code));
    expect(row.clickCount).toBe(2);
    expect(row.firstClickedAt?.getTime()).toBe(now.getTime());
  });

  it("returns null for unknown or malformed codes", async () => {
    expect(await resolveLinkClick(getDb(), "Zz9Zz9Z", { countClick: true, now: new Date() })).toBeNull();
    expect(await resolveLinkClick(getDb(), "../etc", { countClick: true, now: new Date() })).toBeNull();
  });
});
