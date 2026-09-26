import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { handleDataDeletion } from "@/server/instagram/meta-callbacks";
import { parseSignedRequest, readSignedRequest } from "@/server/instagram/signed-request";

export async function POST(req: Request) {
  const env = getEnv();
  const signed = parseSignedRequest(await readSignedRequest(req), [env.IG_APP_SECRET, env.META_APP_SECRET]);
  if (!signed) return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });
  const res = await handleDataDeletion(getDb(), signed.userId, env.APP_URL);
  return NextResponse.json({ url: res.url, confirmation_code: res.confirmationCode });
}
