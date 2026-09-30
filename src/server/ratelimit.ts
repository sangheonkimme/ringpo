import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { commentEvents, igAccounts } from "@/server/db/schema";

const HOUR = 3_600_000;

/**
 * 계정별로 단조 증가하는 발송 슬롯을 예약한다.
 * - 발송 간격: 이전 슬롯 + 1~3초
 * - 시간당 한도: 최근 1시간 예약 중 hourlyLimit번째(최신순) + 1시간 이후
 */
export async function reserveSendSlot(
  db: Db,
  o: { igAccountId: string; eventId: string; now: Date; hourlyLimit: number; random: () => number },
): Promise<Date> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ig-send:${o.igAccountId}`}))`);

    const [acct] = await tx
      .select({ nextReplyAt: igAccounts.nextReplyAt })
      .from(igAccounts)
      .where(eq(igAccounts.id, o.igAccountId));
    if (!acct) throw new Error(`ig account ${o.igAccountId} not found`);

    let t = Math.max(o.now.getTime(), acct.nextReplyAt.getTime());

    const [kth] = await tx
      .select({ at: commentEvents.dmReservedAt })
      .from(commentEvents)
      .where(
        and(
          eq(commentEvents.igAccountId, o.igAccountId),
          gt(commentEvents.dmReservedAt, new Date(o.now.getTime() - HOUR)),
        ),
      )
      .orderBy(desc(commentEvents.dmReservedAt))
      .offset(o.hourlyLimit - 1)
      .limit(1);
    if (kth?.at) t = Math.max(t, kth.at.getTime() + HOUR);

    const slot = new Date(t);
    const gapMs = 1000 + Math.floor(o.random() * 2000);
    await tx.update(igAccounts).set({ nextReplyAt: new Date(t + gapMs) }).where(eq(igAccounts.id, o.igAccountId));
    await tx.update(commentEvents).set({ dmReservedAt: slot }).where(eq(commentEvents.id, o.eventId));
    return slot;
  });
}
