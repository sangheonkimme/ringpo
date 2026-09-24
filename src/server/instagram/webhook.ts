import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { parseJsonWithStringIds } from "./json";

export function verifyHubSignature(
  rawBody: string,
  header: string | null,
  secrets: (string | undefined)[],
): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const hex = header.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
  const given = Buffer.from(hex, "hex");
  return secrets.some((secret) => {
    if (!secret) return false;
    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
    return timingSafeEqual(expected, given);
  });
}

export interface ParsedComment {
  igUserId: string;
  commentId: string;
  mediaId: string;
  mediaProductType: string | null;
  parentCommentId: string | null;
  commenterIgId: string;
  commenterUsername: string | null;
  text: string;
}

const id = z.union([z.string(), z.number()]).transform(String);

const commentValue = z.object({
  id: id.optional(),
  comment_id: id.optional(),
  text: z.string().default(""),
  parent_id: id.optional(),
  from: z.object({ id, username: z.string().optional() }),
  media: z.object({ id, media_product_type: z.string().optional() }),
});

const entrySchema = z.object({
  id,
  changes: z.array(z.object({ field: z.string(), value: z.unknown() })).optional(),
  field: z.string().optional(),
  value: z.unknown().optional(),
});

const payloadSchema = z.object({ entry: z.array(z.unknown()).default([]) });

export function parseCommentWebhook(rawBody: string): ParsedComment[] {
  let json: unknown;
  try {
    json = parseJsonWithStringIds(rawBody);
  } catch {
    return [];
  }
  const payload = payloadSchema.safeParse(json);
  if (!payload.success) return [];

  const out: ParsedComment[] = [];
  for (const rawEntry of payload.data.entry) {
    const entry = entrySchema.safeParse(rawEntry);
    if (!entry.success) continue;
    const changes =
      entry.data.changes ?? (entry.data.field ? [{ field: entry.data.field, value: entry.data.value }] : []);
    for (const change of changes) {
      if (change.field !== "comments") continue;
      const value = commentValue.safeParse(change.value);
      if (!value.success) continue;
      const commentId = value.data.id ?? value.data.comment_id;
      if (!commentId) continue;
      out.push({
        igUserId: entry.data.id,
        commentId,
        mediaId: value.data.media.id,
        mediaProductType: value.data.media.media_product_type ?? null,
        parentCommentId: value.data.parent_id ?? null,
        commenterIgId: value.data.from.id,
        commenterUsername: value.data.from.username ?? null,
        text: value.data.text,
      });
    }
  }
  return out;
}
