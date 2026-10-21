import { describe, expect, it } from "vitest";
import { campaignGateId, parseCampaignMessages } from "@/server/instagram/campaign-messaging";

function envelope(item: unknown, time = 9) { return JSON.stringify({ object: "instagram", entry: [{ id: "business", time, messaging: [item] }] }); }
const message = { sender: { id: "person" }, recipient: { id: "business" }, timestamp: 1792540800000, message: { mid: "m1", text: "팔로우했어요" } };

describe("signed messaging envelope parser", () => {
  it("uses only Meta messaging time, preserving exact large IDs", () => {
    const [row] = parseCampaignMessages(envelope(message));
    expect(row).toMatchObject({ kind: "message", peerId: "person", userMessageEvidence: true, eventKey: "message:m1", occurredAt: new Date(message.timestamp) });
    expect(parseCampaignMessages(envelope({ ...message, sender: { id: "12345678901234567890" } }))[0].senderId).toBe("12345678901234567890");
    const [missing] = parseCampaignMessages(envelope({ ...message, timestamp: undefined }));
    expect(missing.occurredAt).toBeNull(); expect(missing.userMessageEvidence).toBe(false);
  });
  it.each([undefined, null, "1792540800000", -1, 0, 1.5, 9e20])("never substitutes receipt time for invalid timestamp %s", (timestamp) => {
    expect(parseCampaignMessages(envelope({ ...message, timestamp }))[0].userMessageEvidence).toBe(false);
  });
  it("accepts actual quick replies as messages, but a postback alone grants no consent", () => {
    const payload = "cg1:12345678-1234-1234-1234-123456789abc";
    expect(parseCampaignMessages(envelope({ ...message, message: { ...message.message, quick_reply: { payload } } }))[0]).toMatchObject({ payload, userMessageEvidence: true });
    const tap = { ...message, message: undefined, postback: { mid: "source-mid", payload } };
    const [one] = parseCampaignMessages(envelope(tap, 1));
    const [duplicate] = parseCampaignMessages(envelope(tap, 2));
    const [next] = parseCampaignMessages(envelope({ ...tap, timestamp: tap.timestamp + 1 }));
    expect(one.userMessageEvidence).toBe(false); expect(one.eventKey).toBe(duplicate.eventKey); expect(one.eventKey).not.toBe(next.eventKey);
    expect(campaignGateId(payload)).toBe("12345678-1234-1234-1234-123456789abc"); expect(campaignGateId("fg:123")).toBeNull();
  });
  it.each([
    { ...message, recipient: { id: "another-business" } },
    { ...message, message: { mid: "m1", is_echo: true } },
    { ...message, message: { mid: "m1", is_self: true } },
    { ...message, sender: { id: "business" } },
    { ...message, message: { text: "missing id" } },
  ])("drops mismatched account, forged echo, self and unidentified messages", (item) => {
    expect(parseCampaignMessages(envelope(item))).toEqual([]);
  });
  it("distinguishes outgoing echoes and deleted messages without opening a window", () => {
    const [echo] = parseCampaignMessages(envelope({ ...message, sender: { id: "business" }, recipient: { id: "person" }, message: { mid: "out", is_echo: true, text: "셀러 답장" } }));
    expect(echo).toMatchObject({ peerId: "person", kind: "echo", userMessageEvidence: false });
    expect(parseCampaignMessages(envelope({ ...message, message: { mid: "m1", is_deleted: true } }))[0]).toMatchObject({ kind: "deleted", userMessageEvidence: false });
  });
  it.each(["invalid", "{}", '{"object":"page","entry":[]}', '{"object":"instagram","entry":[null]}'])("rejects malformed envelopes", (raw) => { expect(parseCampaignMessages(raw)).toEqual([]); });
});
