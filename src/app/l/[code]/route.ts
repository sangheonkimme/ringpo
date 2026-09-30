import { getDb } from "@/server/db/client";
import { isBotUserAgent, resolveLinkClick } from "@/server/links";

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const target = await resolveLinkClick(getDb(), code, {
    countClick: !isBotUserAgent(req.headers.get("user-agent")),
    now: new Date(),
  });
  if (!target) {
    return new Response("링크를 찾을 수 없어요.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(null, { status: 302, headers: { location: target, "cache-control": "no-store" } });
}
