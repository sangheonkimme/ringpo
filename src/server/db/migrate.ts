import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: process.env.MIGRATIONS_DIR ?? "drizzle" });
  await sql.end();
  console.log(JSON.stringify({ level: "info", msg: "migrations applied" }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
