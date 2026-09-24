import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/server/env";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;
export type Sql = postgres.Sql;

export function createDb(url: string, opts: { max?: number } = {}): { db: Db; sql: Sql } {
  const sql = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

const globalForDb = globalThis as unknown as { __igcDb?: { db: Db; sql: Sql } };

function connection() {
  globalForDb.__igcDb ??= createDb(getEnv().DATABASE_URL);
  return globalForDb.__igcDb;
}

export function getDb(): Db {
  return connection().db;
}

export function getSql(): Sql {
  return connection().sql;
}
