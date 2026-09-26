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
  | { kind: "text"; text: string }
  /** 팔로우 확인 안내: 빠른 답장 버튼(누르면 사용자가 메시지를 보낸 것으로 처리돼 팔로우 조회가 허용된다) */
  | { kind: "gate"; text: string; buttonTitle: string; payload: string }
  /** 빠른 답장이 거절될 때 쓰는 postback 버튼 */
  | { kind: "gate_button"; text: string; buttonTitle: string; payload: string };

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
  /** 우리에게 메시지를 보낸(버튼을 누른) 사람에게 24시간 안에 보내는 일반 메시지 */
  sendMessage(token: string, igUserId: string, recipientId: string, message: PrivateReplyMessage): Promise<{ messageId: string }>;
  /** 그 사람이 비즈니스 계정을 팔로우하는지. 상대가 먼저 메시지를 보낸(버튼을 누른) 뒤에만 조회된다 */
  isFollower(token: string, igsid: string): Promise<boolean>;
}

function messagePayload(message: PrivateReplyMessage) {
  switch (message.kind) {
    case "button":
      return {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: message.text,
            buttons: [{ type: "web_url", url: message.url, title: message.buttonTitle }],
          },
        },
      };
    case "gate":
      return { text: message.text, quick_replies: [{ content_type: "text", title: message.buttonTitle, payload: message.payload }] };
    case "gate_button":
      return {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: message.text,
            buttons: [{ type: "postback", title: message.buttonTitle, payload: message.payload }],
          },
        },
      };
    case "text":
      return { text: message.text };
  }
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
      await request(withToken(`/${igUserId}/subscribed_apps`, token, { subscribed_fields: "comments,messages,messaging_postbacks" }), {
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
      const j = await request(`${base}/${igUserId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { comment_id: commentId }, message: messagePayload(message) }),
      });
      return { messageId: String(j.message_id) };
    },

    async sendMessage(token, igUserId, recipientId, message) {
      const j = await request(`${base}/${igUserId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id: recipientId }, message: messagePayload(message) }),
      });
      return { messageId: String(j.message_id) };
    },

    async isFollower(token, igsid) {
      const j = await request(withToken(`/${igsid}`, token, { fields: "is_user_follow_business" }), { method: "GET" });
      return j.is_user_follow_business === true;
    },
  };
}
