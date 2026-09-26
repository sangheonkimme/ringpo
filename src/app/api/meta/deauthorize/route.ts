import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { handleDeauthorize } from "@/server/instagram/meta-callbacks";
import { parseSignedRequest, readSignedRequest } from "@/server/instagram/signed-request";
import { log } from "@/server/log";

export async function POST(req: Request) {
  const env = getEnv();
  const signed = parseSignedRequest(await readSignedRequest(req), [env.IG_APP_SECRET, env.META_APP_SECRET]);
  if (!signed) return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });
  const count = await handleDeauthorize(getDb(), signed.userId);
  log.info("meta deauthorize", { accounts: count });
  return NextResponse.json({ ok: true });
}
