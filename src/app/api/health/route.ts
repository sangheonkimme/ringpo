import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { workerHeartbeats } from "@/server/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const strict = new URL(req.url).searchParams.get("strict") === "1";
  try {
    const [hb] = await getDb()
      .select({ beatAt: workerHeartbeats.beatAt })
      .from(workerHeartbeats)
      .orderBy(desc(workerHeartbeats.beatAt))
      .limit(1);
    const worker = Boolean(hb && Date.now() - hb.beatAt.getTime() < 60_000);
    const status = strict && !worker ? 503 : 200;
    return NextResponse.json({ ok: status === 200, db: true, worker }, { status, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, db: false, worker: false }, { status: 503 });
  }
}
