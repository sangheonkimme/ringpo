import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSignedRequest } from "@/server/instagram/signed-request";
import { parseCommentWebhook, parseFollowTaps, verifyHubSignature } from "@/server/instagram/webhook";

const sign = (body: string, secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifyHubSignature", () => {
  const body = '{"object":"instagram"}';
  it("accepts a signature from any configured secret", () => {
    expect(verifyHubSignature(body, sign(body, "ig"), ["ig", "meta"])).toBe(true);
    expect(verifyHubSignature(body, sign(body, "meta"), ["ig", "meta"])).toBe(true);
  });
  it("rejects wrong, missing or malformed signatures", () => {
    expect(verifyHubSignature(body, sign(body, "other"), ["ig"])).toBe(false);
    expect(verifyHubSignature(body, null, ["ig"])).toBe(false);
    expect(verifyHubSignature(body, "sha1=abc", ["ig"])).toBe(false);
    expect(verifyHubSignature(body, "sha256=zz", ["ig"])).toBe(false);
  });
  it("ignores empty secrets", () => {
    expect(verifyHubSignature(body, sign(body, ""), ["", undefined])).toBe(false);
  });
});

describe("parseCommentWebhook", () => {
  it("parses the changes[] shape with a large entry id", () => {
    const raw = `{"object":"instagram","entry":[{"id":17841400000000001,"time":1758700000,"changes":[{"field":"comments","value":{"from":{"id":"111","username":"follower1"},"media":{"id":"m1","media_product_type":"REELS"},"id":"c1","parent_id":"p1","text":"공구"}}]}]}`;
    expect(parseCommentWebhook(raw)).toEqual([
      {
        igUserId: "17841400000000001",
        commentId: "c1",
        mediaId: "m1",
        mediaProductType: "REELS",
        parentCommentId: "p1",
        commenterIgId: "111",
        commenterUsername: "follower1",
        text: "공구",
      },
    ]);
  });
  it("parses the flat field/value shape and comment_id", () => {
    const raw = JSON.stringify({
      object: "instagram",
      entry: [{ id: "ig1", field: "comments", value: { from: { id: "u" }, media: { id: "m" }, comment_id: "c9", text: "링크" } }],
    });
    const [c] = parseCommentWebhook(raw);
    expect(c.commentId).toBe("c9");
    expect(c.commenterUsername).toBeNull();
    expect(c.parentCommentId).toBeNull();
  });
  it("skips non-comment fields, malformed values and invalid JSON", () => {
    const raw = JSON.stringify({
      object: "instagram",
      entry: [
        { id: "ig1", changes: [{ field: "mentions", value: {} }, { field: "comments", value: { text: "no ids" } }] },
        { id: "ig1", messaging: [{ sender: { id: "s" } }] },
      ],
    });
    expect(parseCommentWebhook(raw)).toEqual([]);
    expect(parseCommentWebhook("not json")).toEqual([]);
  });
});

describe("parseSignedRequest", () => {
  const make = (payload: object, secret: string) => {
    const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const s = createHmac("sha256", secret).update(p).digest("base64url");
    return `${s}.${p}`;
  };
  it("returns the user id for a valid request", () => {
    expect(parseSignedRequest(make({ algorithm: "HMAC-SHA256", user_id: "218471" }, "ig"), ["ig"])).toEqual({
      userId: "218471",
    });
  });
  it("accepts the second secret", () => {
    expect(parseSignedRequest(make({ algorithm: "HMAC-SHA256", user_id: 5 }, "meta"), ["ig", "meta"])?.userId).toBe("5");
  });
  it("rejects bad signatures and missing user ids", () => {
    expect(parseSignedRequest(make({ user_id: "1" }, "x"), ["ig"])).toBeNull();
    expect(parseSignedRequest(make({ algorithm: "HMAC-SHA256" }, "ig"), ["ig"])).toBeNull();
    expect(parseSignedRequest("garbage", ["ig"])).toBeNull();
  });
});

describe("parseFollowTaps", () => {
  const gate = "5f0c7c1e-1d2b-4c3a-9e8f-0a1b2c3d4e5f";
  const body = (messaging: unknown[]) => JSON.stringify({ object: "instagram", entry: [{ id: "17841400000000001", time: 1, messaging }] });

  it("reads a quick reply tap with our payload", () => {
    const raw = body([{ sender: { id: "900" }, recipient: { id: "17841400000000001" }, message: { mid: "m1", text: "팔로우했어요", quick_reply: { payload: `fg:${gate}` } } }]);
    expect(parseFollowTaps(raw)).toEqual([{ igUserId: "17841400000000001", senderId: "900", gateId: gate }]);
  });

  it("reads a postback button tap", () => {
    const raw = body([{ sender: { id: "900" }, recipient: { id: "17841400000000001" }, postback: { mid: "m2", title: "팔로우했어요", payload: `fg:${gate}` } }]);
    expect(parseFollowTaps(raw)).toEqual([{ igUserId: "17841400000000001", senderId: "900", gateId: gate }]);
  });

  it("ignores echoes of our own messages, plain chats and foreign payloads", () => {
    const raw = body([
      { sender: { id: "17841400000000001" }, recipient: { id: "900" }, message: { mid: "m3", is_echo: true, quick_reply: { payload: `fg:${gate}` } } },
      { sender: { id: "900" }, recipient: { id: "17841400000000001" }, message: { mid: "m4", text: "안녕하세요" } },
      { sender: { id: "900" }, recipient: { id: "17841400000000001" }, postback: { mid: "m5", payload: "OTHER_BOT" } },
      { sender: { id: "900" }, recipient: { id: "17841400000000001" }, postback: { mid: "m6", payload: "fg:not-a-uuid" } },
    ]);
    expect(parseFollowTaps(raw)).toEqual([]);
  });

  it("returns nothing for comment-only or broken payloads", () => {
    expect(parseFollowTaps('{"object":"instagram","entry":[{"id":"1","changes":[]}]}')).toEqual([]);
    expect(parseFollowTaps("{broken")).toEqual([]);
  });
});
