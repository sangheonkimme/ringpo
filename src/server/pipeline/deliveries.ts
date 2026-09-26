import { and, eq } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import { deliveries } from "@/server/db/schema";

export async function reserveDelivery(
  db: Executor,
  key: { automationId: string; mediaId: string; commenterIgId: string; eventId: string },
): Promise<"reserved" | "duplicate"> {
  const inserted = await db
    .insert(deliveries)
    .values(key)
    .onConflictDoNothing({ target: [deliveries.automationId, deliveries.mediaId, deliveries.commenterIgId] })
    .returning({ id: deliveries.id });
  if (inserted.length > 0) return "reserved";
  const [existing] = await db
    .select({ eventId: deliveries.eventId })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.automationId, key.automationId),
        eq(deliveries.mediaId, key.mediaId),
        eq(deliveries.commenterIgId, key.commenterIgId),
      ),
    )
    .limit(1);
  return existing?.eventId === key.eventId ? "reserved" : "duplicate";
}

export async function releaseDelivery(db: Executor, eventId: string): Promise<void> {
  await db.delete(deliveries).where(eq(deliveries.eventId, eventId));
}
