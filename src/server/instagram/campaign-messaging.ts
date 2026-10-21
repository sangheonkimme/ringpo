import { createHash } from "node:crypto";
import { z } from "zod";
import { parseJsonWithStringIds } from "./json";

export const CAMPAIGN_GATE_PREFIX = "cg1:";
const gatePayload = /^cg1:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export function campaignGateId(payload: string | null): string | null { return payload?.match(gatePayload)?.[1].toLowerCase() ?? null; }

export interface ParsedCampaignMessage {
  igUserId: string; senderId: string; recipientId: string; peerId: string;
  eventKey: string; providerMessageId: string | null;
  kind: "message" | "postback" | "echo" | "deleted";
  occurredAt: Date | null; text: string; payload: string | null; replyToMessageId: string | null;
  /** A postback alone is not verified profile consent or a fresh 24-hour window. */
  userMessageEvidence: boolean;
}
const id = z.union([z.string().min(1), z.number().int()]).transform(String);
const itemSchema = z.object({
  sender: z.object({ id }), recipient: z.object({ id }), timestamp: z.unknown().optional(),
  message: z.object({ mid: id.optional(), text: z.string().optional(), is_echo: z.boolean().optional(), is_self: z.boolean().optional(), is_deleted: z.boolean().optional(), quick_reply: z.object({ payload: z.string() }).optional(), reply_to: z.object({ mid: id.optional() }).optional() }).optional(),
  postback: z.object({ mid: id.optional(), payload: z.string().optional() }).optional(),
});
const entrySchema = z.object({ id, messaging: z.array(z.unknown()).default([]) });

/** Pure parser for the official messaging envelope. entry.time is never a message timestamp. */
export function parseCampaignMessages(raw: string): ParsedCampaignMessage[] {
  let decoded: unknown;
  try { decoded = parseJsonWithStringIds(raw); } catch { return []; }
  const payload = z.object({ object: z.literal("instagram"), entry: z.array(z.unknown()) }).safeParse(decoded);
  if (!payload.success) return [];
  const result: ParsedCampaignMessage[] = [];
  for (const unknownEntry of payload.data.entry) {
    const parsedEntry = entrySchema.safeParse(unknownEntry); if (!parsedEntry.success) continue;
    const entry = parsedEntry.data;
    for (const unknownItem of entry.messaging) {
      const parsedItem = itemSchema.safeParse(unknownItem); if (!parsedItem.success) continue;
      const item = parsedItem.data;
      if ((!item.message && !item.postback) || item.message?.is_self) continue;
      const outbound = item.sender.id === entry.id;
      if ((!outbound && item.recipient.id !== entry.id) || item.sender.id === item.recipient.id) continue;
      if (item.message?.is_echo && !outbound) continue; // Never let an incoming user message impersonate a seller echo.
      const kind = item.message?.is_deleted ? "deleted" : outbound ? "echo" : item.postback ? "postback" : "message";
      const providerMessageId = (item.message?.mid ?? item.postback?.mid) || null;
      if ((kind === "message" || kind === "echo" || kind === "deleted") && !providerMessageId) continue;
      const timestamp = typeof item.timestamp === "number" && Number.isSafeInteger(item.timestamp) && item.timestamp > 0 ? item.timestamp : NaN;
      const occurredAt = Number.isNaN(new Date(timestamp).getTime()) ? null : new Date(timestamp);
      const actionPayload = item.message?.quick_reply?.payload ?? item.postback?.payload ?? null;
      // Some postbacks reuse a source message ID. Timestamp + action keeps distinct taps while deduping delivery retries.
      const identity = kind === "postback" ? createHash("sha256").update(JSON.stringify([entry.id, item.sender.id, item.recipient.id, providerMessageId, item.timestamp ?? null, actionPayload])).digest("hex") : providerMessageId;
      result.push({ igUserId: entry.id, senderId: item.sender.id, recipientId: item.recipient.id, peerId: outbound ? item.recipient.id : item.sender.id,
        eventKey: `${kind}:${identity}`, providerMessageId, kind, occurredAt,
        text: (item.message?.text ?? "").slice(0, 4000), payload: actionPayload?.slice(0, 1000) ?? null,
        replyToMessageId: item.message?.reply_to?.mid ?? null, userMessageEvidence: kind === "message" && occurredAt !== null,
      });
    }
  }
  return result;
}
