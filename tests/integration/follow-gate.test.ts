import { createHmac } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as webhookPOST } from "@/app/api/webhooks/instagram/route";
import { decryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { commentEvents, followGates, usageCounters } from "@/server/db/schema";
import { GraphApiError } from "@/server/instagram/errors";
import { FOLLOW_GATE_BUTTON, handleFollowTap } from "@/server/pipeline/follow-gate";
import { processCommentEvent, type PipelineDeps } from "@/server/pipeline/process-comment";
import { setGraphClientForTesting } from "@/server/instagram/client";
import { resetDb } from "../helpers/db";
import { createAutomation, createEvent, createIgAccount, createUser } from "../helpers/factories";
import { FakeGraphClient } from "../helpers/fake-graph";

let graph: FakeGraphClient;

function deps(): PipelineDeps {
  return {
    db: getDb(),
    graph,
    now: () => new Date(),
    random: () => 0,
    sleep: async () => {},
    appUrl: "https://app.test",
    hourlyLimit: 700,
    decryptToken: decryptSecret,
  };
}

async function claim(id: string) {
  const [ev] = await getDb()
    .update(commentEvents)
    .set({ status: "processing", lockedAt: new Date(), attempts: sql`${commentEvents.attempts} + 1` })
    .where(eq(commentEvents.id, id))
    .returning();
  return ev;
}

async function gatedWorld() {
  const u = await createUser();
  const acct = await createIgAccount(u.id, { nextReplyAt: new Date(Date.now() - 60_000) });
  const auto = await createAutomation(acct, { followGate: true, followGateText: "팔로우하고 버튼을 눌러 주세요" });
  const ev = await createEvent(acct, { commentText: "공구", commenterIgId: "900", commenterUsername: "fan" });
  return { u, acct, auto, ev };
}

async function row(id: string) {
  const [r] = await getDb().select().from(commentEvents).where(eq(commentEvents.id, id));
  return r;
}

describe("follow gate", () => {
  beforeEach(async () => {
    await resetDb();
    graph = new FakeGraphClient();
  });

  it("sends the follow-gate message instead of the link and waits for the tap", async () => {
    const { u, ev } = await gatedWorld();
    await processCommentEvent(deps(), await claim(ev.id));

    const [gate] = await getDb().select().from(followGates);
    expect(graph.replies).toHaveLength(1);
    expect(graph.dms).toHaveLength(1);
    expect(graph.dms[0].message).toEqual({
      kind: "gate_button",
      text: "팔로우하고 버튼을 눌러 주세요",
      buttonTitle: FOLLOW_GATE_BUTTON,
      payload: `fg:${gate.id}`,
    });
    expect(gate).toMatchObject({ eventId: ev.id, status: "waiting" });
    const r = await row(ev.id);
    expect(r).toMatchObject({ status: "awaiting_follow", replyStatus: "sent", dmStatus: null });
    const [usage] = await getDb().select().from(usageCounters).where(eq(usageCounters.userId, u.id));
    expect(usage.dmCount).toBe(1);
  });

  it("falls back to a quick reply when the in-bubble button is rejected", async () => {
    const { ev } = await gatedWorld();
    graph.dmError = (m) => (m.kind === "gate_button" ? new GraphApiError("invalid", 400, 100) : null);
    await processCommentEvent(deps(), await claim(ev.id));
    expect(graph.dms.map((d) => d.message.kind)).toEqual(["gate"]);
    expect((await row(ev.id)).status).toBe("awaiting_follow");
  });

  it("sends the link once a follower taps the button", async () => {
    const { acct, ev } = await gatedWorld();
    await processCommentEvent(deps(), await claim(ev.id));
    const [gate] = await getDb().select().from(followGates);
    graph.followers.add("900");

    const outcome = await handleFollowTap(deps(), { igUserId: acct.igUserId, senderId: "900", gateId: gate.id });

    expect(outcome).toBe("sent");
    expect(graph.messages).toHaveLength(1);
    expect(graph.messages[0]).toMatchObject({ recipientId: "900", message: { kind: "button", buttonTitle: "구매하기", url: "https://shop.example.com/p/1" } });
    expect(await row(ev.id)).toMatchObject({ status: "succeeded", dmStatus: "sent" });
    const [after] = await getDb().select().from(followGates);
    expect(after).toMatchObject({ status: "sent", senderId: "900", checks: 1 });
  });

  it("asks again when the person still does not follow", async () => {
    const { acct, ev } = await gatedWorld();
    await processCommentEvent(deps(), await claim(ev.id));
    const [gate] = await getDb().select().from(followGates);

    const outcome = await handleFollowTap(deps(), { igUserId: acct.igUserId, senderId: "900", gateId: gate.id });

    expect(outcome).toBe("not_following");
    expect(graph.messages).toHaveLength(1);
    expect(graph.messages[0].message).toMatchObject({ kind: "gate_button", payload: `fg:${gate.id}` });
    expect((await row(ev.id)).status).toBe("awaiting_follow");
    const [after] = await getDb().select().from(followGates);
    expect(after).toMatchObject({ status: "waiting", checks: 1 });
  });

  it("asks for one more tap with a quick reply when Instagram refuses the follow lookup", async () => {
    const { acct, ev } = await gatedWorld();
    await processCommentEvent(deps(), await claim(ev.id));
    const [gate] = await getDb().select().from(followGates);
    graph.followError = new GraphApiError("User consent is required to access user profile", 400, 230);

    const outcome = await handleFollowTap(deps(), { igUserId: acct.igUserId, senderId: "900", gateId: gate.id });

    expect(outcome).toBe("needs_consent");
    expect(graph.messages[0].message).toMatchObject({ kind: "gate", payload: `fg:${gate.id}` });
    expect((await row(ev.id)).status).toBe("awaiting_follow");
  });

  it("ignores taps for another account's gate and taps after the link was sent", async () => {
    const { acct, ev } = await gatedWorld();
    await processCommentEvent(deps(), await claim(ev.id));
    const [gate] = await getDb().select().from(followGates);

    expect(await handleFollowTap(deps(), { igUserId: "someone-else", senderId: "900", gateId: gate.id })).toBe("ignored");
    graph.followers.add("900");
    await handleFollowTap(deps(), { igUserId: acct.igUserId, senderId: "900", gateId: gate.id });
    expect(await handleFollowTap(deps(), { igUserId: acct.igUserId, senderId: "900", gateId: gate.id })).toBe("ignored");
    expect(graph.messages).toHaveLength(1);
  });

  it("handles a tap that arrives through the webhook route", async () => {
    const { acct, ev } = await gatedWorld();
    await processCommentEvent(deps(), await claim(ev.id));
    const [gate] = await getDb().select().from(followGates);
    graph.followers.add("900");
    setGraphClientForTesting(graph);

    const body = JSON.stringify({
      object: "instagram",
      entry: [{ id: acct.igUserId, time: 1, messaging: [{ sender: { id: "900" }, recipient: { id: acct.igUserId }, message: { mid: "m1", text: "팔로우했어요", quick_reply: { payload: `fg:${gate.id}` } } }] }],
    });
    const sig = `sha256=${createHmac("sha256", process.env.IG_APP_SECRET ?? "").update(body).digest("hex")}`;
    const res = await webhookPOST(new Request("http://localhost/api/webhooks/instagram", { method: "POST", body, headers: { "x-hub-signature-256": sig } }));

    expect(res.status).toBe(200);
    expect(graph.messages).toHaveLength(1);
    expect((await row(ev.id)).status).toBe("succeeded");
    setGraphClientForTesting(null);
  });
});
