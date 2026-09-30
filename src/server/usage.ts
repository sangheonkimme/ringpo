import { and, eq, sql } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import { usageCounters } from "@/server/db/schema";

const KST_OFFSET_MS = 9 * 3_600_000;

export function usagePeriod(now: Date): string {
  const k = new Date(now.getTime() + KST_OFFSET_MS);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 한도 안이면 1건 예약하고 예약한 월을, 초과면 null을 반환한다. */
export async function reserveDm(db: Executor, userId: string, limit: number, now: Date): Promise<string | null> {
  const period = usagePeriod(now);
  const rows = await db
    .insert(usageCounters)
    .values({ userId, period, dmCount: 1 })
    .onConflictDoUpdate({
      target: [usageCounters.userId, usageCounters.period],
      set: { dmCount: sql`${usageCounters.dmCount} + 1` },
      setWhere: sql`${usageCounters.dmCount} < ${limit}`,
    })
    .returning({ dmCount: usageCounters.dmCount });
  return rows.length > 0 ? period : null;
}

export async function releaseDm(db: Executor, userId: string, period: string): Promise<void> {
  await db
    .update(usageCounters)
    .set({ dmCount: sql`greatest(${usageCounters.dmCount} - 1, 0)` })
    .where(and(eq(usageCounters.userId, userId), eq(usageCounters.period, period)));
}

export async function getDmUsage(db: Executor, userId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ dmCount: usageCounters.dmCount })
    .from(usageCounters)
    .where(and(eq(usageCounters.userId, userId), eq(usageCounters.period, usagePeriod(now))));
  return row?.dmCount ?? 0;
}
