import { readFile } from "node:fs/promises";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, getSql } from "@/server/db/client";
import { campaigns, featureFlags, user } from "@/server/db/schema";
import { DEFAULT_CAMPAIGN_TEMPLATES } from "@/lib/campaign-schema";
import { createUser, createIgAccount } from "../helpers/factories";
import { resetDb } from "../helpers/db";

async function rollback() {
  const connection = await getSql().reserve();
  try {
    await connection.unsafe(await readFile("drizzle/rollback/0002_gonggu_foundation.sql", "utf8"));
  } catch (error) {
    await connection`rollback`;
    throw error;
  } finally { connection.release(); }
}

describe("campaign foundation migration", () => {
  beforeEach(resetDb);

  it("rolls down and up without touching legacy users and seeds the flag disabled", async () => {
    const owner = await createUser();
    await rollback();
    expect((await getSql()`select to_regclass('campaigns') as name`)[0].name).toBeNull();
    expect((await getDb().select().from(user))[0].id).toBe(owner.id);
    await migrate(getDb(), { migrationsFolder: "drizzle" });
    expect((await getDb().select().from(featureFlags))[0]).toMatchObject({ key: "gonggu_campaigns", enabled: false, defaultEnabled: false });
    expect(await getDb().select().from(campaigns)).toHaveLength(0);
  });

  it("refuses to drop existing campaigns", async () => {
    const owner = await createUser(); const account = await createIgAccount(owner.id);
    await getDb().insert(campaigns).values({ userId: owner.id, igAccountId: account.id, title: "보존", slug: "keep", openAt: new Date("2026-10-22"), closeAt: new Date("2026-10-23"), notificationKeywords: ["알림"], linkKeywords: ["링크"], templates: DEFAULT_CAMPAIGN_TEMPLATES, hourlyRate: 400 });
    await expect(rollback()).rejects.toThrow("Campaign data exists");
    expect(await getDb().select().from(campaigns)).toHaveLength(1);
  });
});
