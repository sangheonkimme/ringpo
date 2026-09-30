import { randomInt } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import { links } from "@/server/db/schema";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BOT_UA =
  /(facebookexternalhit|facebot|meta-externalagent|bot\b|crawler|spider|preview|slackbot|kakaotalk-scrap|twitterbot|whatsapp|telegrambot|discordbot)/i;

export function generateCode(length = 7): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export function isBotUserAgent(ua: string | null): boolean {
  return !ua || BOT_UA.test(ua);
}

export async function getOrCreateEventLink(
  db: Executor,
  p: { eventId: string; automationId: string; targetUrl: string },
): Promise<string> {
  const [existing] = await db.select({ code: links.code }).from(links).where(eq(links.eventId, p.eventId)).limit(1);
  if (existing) return existing.code;
  for (let i = 0; i < 5; i++) {
    const rows = await db
      .insert(links)
      .values({ code: generateCode(), eventId: p.eventId, automationId: p.automationId, targetUrl: p.targetUrl })
      .onConflictDoNothing({ target: links.code })
      .returning({ code: links.code });
    if (rows[0]) return rows[0].code;
  }
  throw new Error("could not allocate a unique link code");
}

export async function resolveLinkClick(
  db: Executor,
  code: string,
  o: { countClick: boolean; now: Date },
): Promise<string | null> {
  if (!/^[0-9A-Za-z]{4,16}$/.test(code)) return null;
  if (!o.countClick) {
    const [row] = await db.select({ targetUrl: links.targetUrl }).from(links).where(eq(links.code, code)).limit(1);
    return row?.targetUrl ?? null;
  }
  const [row] = await db
    .update(links)
    .set({
      clickCount: sql`${links.clickCount} + 1`,
      firstClickedAt: sql`coalesce(${links.firstClickedAt}, ${o.now.toISOString()}::timestamptz)`,
      lastClickedAt: o.now,
    })
    .where(eq(links.code, code))
    .returning({ targetUrl: links.targetUrl });
  return row?.targetUrl ?? null;
}
