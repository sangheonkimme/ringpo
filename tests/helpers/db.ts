import { getSql } from "@/server/db/client";

export async function resetDb(): Promise<void> {
  const sql = getSql();
  const tables = await sql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public'`;
  if (tables.length === 0) return;
  await sql.unsafe(
    `truncate table ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`,
  );
}
