import { describe, expect, it, vi } from "vitest";
import { GraphApiError } from "@/server/instagram/errors";
import { buildAuthorizeUrl, exchangeCodeForToken, exchangeForLongLivedToken } from "@/server/instagram/oauth";

describe("buildAuthorizeUrl", () => {
  it("includes required params and scopes", () => {
    const u = new URL(buildAuthorizeUrl({ appId: "app", redirectUri: "https://x.y/cb", state: "st" }));
    expect(u.origin + u.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe(
      "instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages",
    );
    expect(u.searchParams.get("state")).toBe("st");
  });
});

describe("exchangeCodeForToken", () => {
  it("parses the wrapped data[] shape and strips #_ from the code", async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) =>
      new Response('{"data":[{"access_token":"short","user_id":17841400000000001,"permissions":"a,b"}]}'),
    );
    const res = await exchangeCodeForToken({ appId: "app", appSecret: "s", redirectUri: "https://x/cb", code: "abc#_", fetchFn: f });
    expect(res).toEqual({ accessToken: "short", userId: "17841400000000001", permissions: ["a", "b"] });
    const body = f.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get("code")).toBe("abc");
    expect(body.get("grant_type")).toBe("authorization_code");
  });

  it("parses the flat shape with a permissions array", async () => {
    const f = vi.fn(async () => new Response('{"access_token":"short","user_id":"42","permissions":["a"]}'));
    await expect(
      exchangeCodeForToken({ appId: "app", appSecret: "s", redirectUri: "r", code: "c", fetchFn: f }),
    ).resolves.toEqual({ accessToken: "short", userId: "42", permissions: ["a"] });
  });

  it("throws GraphApiError on OAuth errors", async () => {
    const f = vi.fn(
      async () =>
        new Response('{"error_type":"OAuthException","code":400,"error_message":"Matching code was not found"}', { status: 400 }),
    );
    await expect(
      exchangeCodeForToken({ appId: "app", appSecret: "s", redirectUri: "r", code: "c", fetchFn: f }),
    ).rejects.toBeInstanceOf(GraphApiError);
  });
});

describe("exchangeForLongLivedToken", () => {
  it("returns token and lifetime", async () => {
    const f = vi.fn(async (_u: string | URL | Request) => new Response('{"access_token":"long","token_type":"bearer","expires_in":5183944}'));
    await expect(exchangeForLongLivedToken({ appSecret: "s", shortToken: "short", fetchFn: f })).resolves.toEqual({
      accessToken: "long",
      expiresIn: 5183944,
    });
    const url = new URL(String(f.mock.calls[0][0]));
    expect(url.searchParams.get("grant_type")).toBe("ig_exchange_token");
  });
});
