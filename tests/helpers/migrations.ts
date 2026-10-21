import { randomBytes } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, getSql } from "@/server/db/client";

/** Each rollback test owns an isolated database and a frozen prefix of the migration chain. */
export async function migrationDatabase(through: number) {
  const name = `igc_test_migration_${randomBytes(8).toString("hex")}`;
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/igc_test");
  url.pathname = `/${name}`;
  const folder = await mkdtemp(join(tmpdir(), "gonggu-migrations-"));
  await mkdir(join(folder, "meta"));
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= through);
  await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
  for (const entry of journal.entries) await copyFile(`drizzle/${entry.tag}.sql`, join(folder, `${entry.tag}.sql`));
  await getSql().unsafe(`create database "${name}"`);
  const connection = createDb(url.toString(), { max: 1 });
  const up = () => migrate(connection.db, { migrationsFolder: folder });
  const down = async (path: string) => {
    try { await connection.sql.unsafe(await readFile(path, "utf8")); }
    catch (error) { await connection.sql`rollback`; throw error; }
  };
  const close = async () => {
    await connection.sql.end();
    await getSql().unsafe(`drop database "${name}"`);
    await rm(folder, { recursive: true, force: true });
  };
  try { await up(); } catch (error) { await close(); throw error; }
  return { ...connection, up, down, close };
}
