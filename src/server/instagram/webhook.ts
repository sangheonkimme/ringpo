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

/** '팔로우했어요' 버튼 응답의 payload 접두사. 뒤에 follow_gates.id(uuid)가 붙는다 */
export const FOLLOW_GATE_PAYLOAD_PREFIX = "fg:";
const GATE_PAYLOAD = /^fg:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface FollowTap {
  /** 알림을 받은 비즈니스 계정의 인스타 사용자 ID */
  igUserId: string;
  /** 버튼을 누른 사람(IGSID) */
  senderId: string;
  gateId: string;
}

const messagingItem = z.object({
  sender: z.object({ id }),
  message: z
    .object({ is_echo: z.boolean().optional(), quick_reply: z.object({ payload: z.string() }).optional() })
    .optional(),
  postback: z.object({ payload: z.string().optional() }).optional(),
});

const messagingEntry = z.object({ id, messaging: z.array(z.unknown()).optional() });

/** 메시지 웹훅(messages·messaging_postbacks)에서 링포 팔로우 확인 버튼을 누른 것만 골라낸다 */
export function parseFollowTaps(rawBody: string): FollowTap[] {
  let json: unknown;
  try {
    json = parseJsonWithStringIds(rawBody);
  } catch {
    return [];
  }
  const payload = payloadSchema.safeParse(json);
  if (!payload.success) return [];
  const out: FollowTap[] = [];
  for (const rawEntry of payload.data.entry) {
    const entry = messagingEntry.safeParse(rawEntry);
    if (!entry.success) continue;
    for (const raw of entry.data.messaging ?? []) {
      const item = messagingItem.safeParse(raw);
      if (!item.success || item.data.message?.is_echo) continue;
      const tapped = item.data.message?.quick_reply?.payload ?? item.data.postback?.payload ?? "";
      const m = GATE_PAYLOAD.exec(tapped);
      if (m) out.push({ igUserId: entry.data.id, senderId: item.data.sender.id, gateId: m[1].toLowerCase() });
    }
  }
  return out;
}
