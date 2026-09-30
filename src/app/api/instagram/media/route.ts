import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { decryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { igAccounts } from "@/server/db/schema";
import { getGraphClient } from "@/server/instagram/client";
import { classifyError, errorReasonKo } from "@/server/instagram/errors";
import { getSessionUser } from "@/server/session";

const query = z.object({ accountId: z.uuid(), after: z.string().max(500).optional() });

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요" }, { status: 401 });
  const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "잘못된 요청이에요" }, { status: 400 });

  const [acct] = await getDb()
    .select()
    .from(igAccounts)
    .where(and(eq(igAccounts.id, parsed.data.accountId), eq(igAccounts.userId, user.id), eq(igAccounts.status, "active")))
    .limit(1);
  if (!acct?.accessTokenEnc) return NextResponse.json({ error: "계정을 찾을 수 없어요" }, { status: 404 });

  try {
    const res = await getGraphClient().listMedia(decryptSecret(acct.accessTokenEnc), acct.igUserId, parsed.data.after);
    return NextResponse.json({
      items: res.items.map((m) => ({
        id: m.id,
        caption: m.caption ? Array.from(m.caption).slice(0, 120).join("") : null,
        thumbnailUrl: m.thumbnailUrl ?? m.mediaUrl,
        permalink: m.permalink,
        mediaType: m.mediaType,
        timestamp: m.timestamp?.toISOString() ?? null,
      })),
      nextCursor: res.nextCursor,
    });
  } catch (e) {
    const c = classifyError(e);
    if (c.cls === "auth") {
      await getDb().update(igAccounts).set({ status: "reauth_required" }).where(eq(igAccounts.id, acct.id));
    }
    return NextResponse.json({ error: errorReasonKo(c.code) }, { status: 502 });
  }
}
