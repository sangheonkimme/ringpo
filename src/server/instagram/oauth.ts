import { GraphApiError, GraphNetworkError } from "./errors";
import { parseJsonWithStringIds } from "./json";

export const IG_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
] as const;

export function buildAuthorizeUrl(p: { appId: string; redirectUri: string; state: string }): string {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: p.appId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: IG_SCOPES.join(","),
    state: p.state,
  }).toString();
  return url.toString();
}

type Json = Record<string, unknown>;

async function readJson(res: Response): Promise<Json> {
  const text = await res.text();
  try {
    return text ? (parseJsonWithStringIds(text) as Json) : {};
  } catch {
    return {};
  }
}

async function safeFetch(f: typeof fetch, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await f(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    throw new GraphNetworkError(e instanceof Error ? e.message : String(e));
  }
}

function oauthError(res: Response, j: Json): GraphApiError {
  const nested = j.error as { message?: string; code?: number } | undefined;
  const message = (j.error_message as string | undefined) ?? nested?.message ?? `HTTP ${res.status}`;
  const code = typeof j.code === "number" ? j.code : nested?.code;
  return new GraphApiError(message, res.status, code);
}

export async function exchangeCodeForToken(p: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
  fetchFn?: typeof fetch;
}): Promise<{ accessToken: string; userId: string; permissions: string[] }> {
  const body = new URLSearchParams({
    client_id: p.appId,
    client_secret: p.appSecret,
    grant_type: "authorization_code",
    redirect_uri: p.redirectUri,
    code: p.code.replace(/#_$/, ""),
  });
  const res = await safeFetch(p.fetchFn ?? fetch, "https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body,
  });
  const j = await readJson(res);
  if (!res.ok || j.error_type || j.error) throw oauthError(res, j);
  const d = (Array.isArray(j.data) ? j.data[0] : j) as Json;
  const perms = d.permissions;
  const permissions = Array.isArray(perms)
    ? perms.map(String)
    : String(perms ?? "")
        .split(",")
        .filter(Boolean);
  return { accessToken: String(d.access_token), userId: String(d.user_id), permissions };
}

export async function exchangeForLongLivedToken(p: {
  appSecret: string;
  shortToken: string;
  fetchFn?: typeof fetch;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const url = new URL("https://graph.instagram.com/access_token");
  url.search = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: p.appSecret,
    access_token: p.shortToken,
  }).toString();
  const res = await safeFetch(p.fetchFn ?? fetch, url.toString());
  const j = await readJson(res);
  if (!res.ok || j.error) throw oauthError(res, j);
  return { accessToken: String(j.access_token), expiresIn: Number(j.expires_in) };
}
