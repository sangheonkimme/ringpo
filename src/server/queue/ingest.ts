import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { automations, igAccounts, type NewCommentEvent } from "@/server/db/schema";
import type { ParsedComment } from "@/server/instagram/webhook";
import { enqueueComments } from "./events";

export async function ingestComments(db: Db, comments: ParsedComment[], now: Date): Promise<number> {
  const candidates = comments.filter((c) => c.commenterIgId !== c.igUserId);
  if (candidates.length === 0) return 0;
  const igIds = [...new Set(candidates.map((c) => c.igUserId))];
  const accounts = await db
    .selectDistinct({ id: igAccounts.id, igUserId: igAccounts.igUserId })
    .from(igAccounts)
    .innerJoin(automations, and(eq(automations.igAccountId, igAccounts.id), eq(automations.isActive, true)))
    .where(and(inArray(igAccounts.igUserId, igIds), eq(igAccounts.status, "active")));
  const byIgId = new Map(accounts.map((a) => [a.igUserId, a.id]));

  const rows: NewCommentEvent[] = [];
  for (const c of candidates) {
    const igAccountId = byIgId.get(c.igUserId);
    if (!igAccountId) continue;
    rows.push({
      igAccountId,
      commentId: c.commentId,
      mediaId: c.mediaId,
      parentCommentId: c.parentCommentId,
      mediaProductType: c.mediaProductType,
      commenterIgId: c.commenterIgId,
      commenterUsername: c.commenterUsername,
      commentText: c.text,
      receivedAt: now,
      runAt: now,
    });
  }
  return enqueueComments(db, rows);
}
