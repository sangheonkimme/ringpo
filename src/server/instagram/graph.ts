import { GraphApiError, GraphNetworkError } from "./errors";
import { parseJsonWithStringIds } from "./json";

export interface IgProfile {
  id: string;
  userId: string;
  username: string;
  accountType: string;
  profilePictureUrl: string | null;
}

export interface MediaInfo {
  id: string;
  caption: string | null;
  mediaType: string | null;
  mediaProductType: string | null;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  permalink: string | null;
  timestamp: Date | null;
}

export type PrivateReplyMessage =
  | { kind: "button"; text: string; buttonTitle: string; url: string }
  | { kind: "text"; text: string };

export interface GraphClient {
  getMe(token: string): Promise<IgProfile>;
  subscribeApp(token: string, igUserId: string): Promise<void>;
  refreshToken(token: string): Promise<{ accessToken: string; expiresIn: number }>;
  listMedia(token: string, igUserId: string, after?: string): Promise<{ items: MediaInfo[]; nextCursor: string | null }>;
  getMedia(token: string, mediaId: string): Promise<MediaInfo>;
  replyToComment(token: string, commentId: string, message: string): Promise<{ id: string }>;
  sendPrivateReply(
    token: string,
    igUserId: string,
    commentId: string,
    message: PrivateReplyMessage,
  ): Promise<{ messageId: string }>;
}

const MEDIA_FIELDS = "id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp";

type Json = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : null;
}

function parseIgTime(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toMedia(m: Json): MediaInfo {
  return {
    id: str(m.id) ?? "",
    caption: str(m.caption),
    mediaType: str(m.media_type),
    mediaProductType: str(m.media_product_type),
    thumbnailUrl: str(m.thumbnail_url),
    mediaUrl: str(m.media_url),
    permalink: str(m.permalink),
    timestamp: parseIgTime(m.timestamp),
  };
}

function unwrapSingle(j: Json): Json {
  const data = j.data;
  return Array.isArray(data) && data.length === 1 && !("paging" in j) ? (data[0] as Json) : j;
}

export function createGraphClient(opts: {
  version: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): GraphClient {
  const base = `https://graph.instagram.com/${opts.version}`;
  const f = opts.fetchFn ?? fetch;

  async function request(url: string, init: RequestInit): Promise<Json> {
    let res: Response;
    try {
      res = await f(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) });
    } catch (e) {
      throw new GraphNetworkError(e instanceof Error ? e.message : String(e));
    }
    const text = await res.text();
    let json: Json = {};
    try {
      json = text ? (parseJsonWithStringIds(text) as Json) : {};
    } catch {
      json = {};
    }
    const error = json.error as { message?: string; code?: number; error_subcode?: number } | undefined;
    if (!res.ok || error) {
      throw new GraphApiError(error?.message ?? `HTTP ${res.status}`, res.status, error?.code, error?.error_subcode);
    }
    return json;
  }

  const withToken = (path: string, token: string, params: Record<string, string> = {}) => {
    const url = new URL(path.startsWith("http") ? path : `${base}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", token);
    return url.toString();
  };

  return {
    async getMe(token) {
      const j = unwrapSingle(
        await request(withToken("/me", token, { fields: "id,user_id,username,account_type,profile_picture_url" }), {
          method: "GET",
        }),
      );
      return {
        id: str(j.id) ?? "",
        userId: str(j.user_id) ?? str(j.id) ?? "",
        username: str(j.username) ?? "",
        accountType: str(j.account_type) ?? "",
        profilePictureUrl: str(j.profile_picture_url),
      };
    },

    async subscribeApp(token, igUserId) {
      await request(withToken(`/${igUserId}/subscribed_apps`, token, { subscribed_fields: "comments" }), {
        method: "POST",
      });
    },

    async refreshToken(token) {
      const j = await request(
        withToken("https://graph.instagram.com/refresh_access_token", token, { grant_type: "ig_refresh_token" }),
        { method: "GET" },
      );
      return { accessToken: String(j.access_token), expiresIn: Number(j.expires_in) };
    },

    async listMedia(token, igUserId, after) {
      const params: Record<string, string> = { fields: MEDIA_FIELDS, limit: "24" };
      if (after) params.after = after;
      const j = await request(withToken(`/${igUserId}/media`, token, params), { method: "GET" });
      const items = Array.isArray(j.data) ? (j.data as Json[]).map(toMedia) : [];
      const paging = j.paging as { cursors?: { after?: string }; next?: string } | undefined;
      return { items, nextCursor: paging?.next ? (paging.cursors?.after ?? null) : null };
    },

    async getMedia(token, mediaId) {
      return toMedia(await request(withToken(`/${mediaId}`, token, { fields: MEDIA_FIELDS }), { method: "GET" }));
    },

    async replyToComment(token, commentId, message) {
      const j = await request(withToken(`/${commentId}/replies`, token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      return { id: String(j.id) };
    },

    async sendPrivateReply(token, igUserId, commentId, message) {
      const payload =
        message.kind === "button"
          ? {
              attachment: {
                type: "template",
                payload: {
                  template_type: "button",
                  text: message.text,
                  buttons: [{ type: "web_url", url: message.url, title: message.buttonTitle }],
                },
              },
            }
          : { text: message.text };
      const j = await request(`${base}/${igUserId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { comment_id: commentId }, message: payload }),
      });
      return { messageId: String(j.message_id) };
    },
  };
}
