import { getDb } from "@/server/db/client";
import { countCampaignClick, resolveCampaignClick } from "@/server/campaigns/links";

async function resolve(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const target = await resolveCampaignClick(getDb(), (await ctx.params).code, countCampaignClick(req));
  const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" };
  if (!target) return new Response(req.method === "HEAD" ? null : "링크를 찾을 수 없어요.", { status: 404, headers: { ...headers, "content-type": "text/plain; charset=utf-8" } });
  return new Response(null, { status: 302, headers: { ...headers, location: target } });
}

export const GET = resolve;
// Next otherwise automatically delegates HEAD to GET. A preview must never count as a click.
export const HEAD = resolve;
