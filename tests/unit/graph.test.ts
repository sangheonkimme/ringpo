import { describe, expect, it, vi } from "vitest";
import { GraphApiError, GraphNetworkError } from "@/server/instagram/errors";
import { createGraphClient } from "@/server/instagram/graph";

function mockFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
}

describe("createGraphClient", () => {
  it("getMe reads id and user_id as strings (flat or wrapped)", async () => {
    const f = mockFetch(200, '{"data":[{"id":17841400000000009,"user_id":17841400000000001,"username":"creator","account_type":"MEDIA_CREATOR"}]}');
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    await expect(client.getMe("tok")).resolves.toEqual({
      id: "17841400000000009",
      userId: "17841400000000001",
      username: "creator",
      accountType: "MEDIA_CREATOR",
      profilePictureUrl: null,
    });
    const url = new URL(String(f.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://graph.instagram.com/v26.0/me");
    expect(url.searchParams.get("access_token")).toBe("tok");
  });

  it("replyToComment posts the message and returns the reply id", async () => {
    const f = mockFetch(200, { id: "17873440459141029" });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    await expect(client.replyToComment("tok", "c1", "@a DM 확인!")).resolves.toEqual({ id: "17873440459141029" });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain("/v26.0/c1/replies");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ message: "@a DM 확인!" });
  });

  it("sendPrivateReply builds a button template body with bearer auth", async () => {
    const f = mockFetch(200, { recipient_id: "5261234567890123456", message_id: "mid.1" });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    await expect(
      client.sendPrivateReply("tok", "ig1", "c1", { kind: "button", text: "링크", buttonTitle: "구매", url: "https://x.y" }),
    ).resolves.toEqual({ messageId: "mid.1" });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe("https://graph.instagram.com/v26.0/ig1/messages");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init?.body))).toEqual({
      recipient: { comment_id: "c1" },
      message: {
        attachment: {
          type: "template",
          payload: { template_type: "button", text: "링크", buttons: [{ type: "web_url", url: "https://x.y", title: "구매" }] },
        },
      },
    });
  });

  it("sendPrivateReply builds a text body", async () => {
    const f = mockFetch(200, { message_id: "mid.2" });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    await client.sendPrivateReply("tok", "ig1", "c1", { kind: "text", text: "hello" });
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ recipient: { comment_id: "c1" }, message: { text: "hello" } });
  });

  it("sendPrivateReply sends a follow-gate quick reply with our payload", async () => {
    const f = mockFetch(200, { message_id: "mid.2" });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    await client.sendPrivateReply("tok", "ig1", "c1", { kind: "gate", text: "팔로우해 주세요", buttonTitle: "팔로우했어요", payload: "fg:abc" });
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({
      recipient: { comment_id: "c1" },
      message: { text: "팔로우해 주세요", quick_replies: [{ content_type: "text", title: "팔로우했어요", payload: "fg:abc" }] },
    });
  });

  it("sendPrivateReply can fall back to a postback button for the follow gate", async () => {
    const f = mockFetch(200, { message_id: "mid.3" });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    await client.sendPrivateReply("tok", "ig1", "c1", { kind: "gate_button", text: "팔로우해 주세요", buttonTitle: "팔로우했어요", payload: "fg:abc" });
    expect(JSON.parse(String(f.mock.calls[0][1]?.body)).message).toEqual({
      attachment: {
        type: "template",
        payload: { template_type: "button", text: "팔로우해 주세요", buttons: [{ type: "postback", title: "팔로우했어요", payload: "fg:abc" }] },
      },
    });
  });

  it("sendMessage addresses a person who messaged us by their id", async () => {
    const f = mockFetch(200, { message_id: "mid.4" });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    await expect(client.sendMessage("tok", "ig1", "900", { kind: "text", text: "링크예요" })).resolves.toEqual({ messageId: "mid.4" });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain("/v26.0/ig1/messages");
    expect(JSON.parse(String(init?.body))).toEqual({ recipient: { id: "900" }, message: { text: "링크예요" } });
  });

  it("isFollower reads is_user_follow_business", async () => {
    const f = mockFetch(200, { is_user_follow_business: true, id: "900" });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    await expect(client.isFollower("tok", "900")).resolves.toBe(true);
    const url = new URL(String(f.mock.calls[0][0]));
    expect(url.pathname).toBe("/v26.0/900");
    expect(url.searchParams.get("fields")).toBe("is_user_follow_business");
    const g = createGraphClient({ version: "v26.0", fetchFn: mockFetch(200, { id: "900" }) });
    await expect(g.isFollower("tok", "900")).resolves.toBe(false);
  });

  it("subscribeApp also subscribes to message events for the follow gate", async () => {
    const f = mockFetch(200, { success: true });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    await client.subscribeApp("tok", "ig1");
    expect(new URL(String(f.mock.calls[0][0])).searchParams.get("subscribed_fields")).toBe("comments,messages,messaging_postbacks");
  });

  it("maps Graph error payloads to GraphApiError with code and subcode", async () => {
    const f = mockFetch(400, { error: { message: "limit", code: 613, error_subcode: 2534040 } });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    const e = await client.replyToComment("tok", "c1", "x").catch((x) => x);
    expect(e).toBeInstanceOf(GraphApiError);
    expect(e).toMatchObject({ httpStatus: 400, code: 613, subcode: 2534040 });
  });

  it("maps fetch failures to GraphNetworkError", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    await expect(client.getMe("tok")).rejects.toBeInstanceOf(GraphNetworkError);
  });

  it("listMedia parses items, timestamps and the next cursor", async () => {
    const f = mockFetch(200, {
      data: [{ id: "m1", caption: "공구 오픈", media_type: "VIDEO", thumbnail_url: "https://t", permalink: "https://p", timestamp: "2026-09-20T12:34:56+0000" }],
      paging: { cursors: { after: "CUR" }, next: "https://next" },
    });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    const res = await client.listMedia("tok", "ig1");
    expect(res.nextCursor).toBe("CUR");
    expect(res.items[0]).toMatchObject({ id: "m1", caption: "공구 오픈", thumbnailUrl: "https://t", mediaProductType: null });
    expect(res.items[0].timestamp?.toISOString()).toBe("2026-09-20T12:34:56.000Z");
  });

  it("refreshToken calls the unversioned refresh endpoint", async () => {
    const f = mockFetch(200, { access_token: "new", token_type: "bearer", expires_in: 5183944 });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    await expect(client.refreshToken("old")).resolves.toEqual({ accessToken: "new", expiresIn: 5183944 });
    const url = new URL(String(f.mock.calls[0][0]));
    expect(url.pathname).toBe("/refresh_access_token");
    expect(url.searchParams.get("grant_type")).toBe("ig_refresh_token");
  });
});
