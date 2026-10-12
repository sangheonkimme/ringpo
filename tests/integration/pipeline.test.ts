import { eq, sql } from "drizzle-orm";
import { PLANS } from "@/lib/plans";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { automations, commentEvents, deliveries, igAccounts, links, usageCounters, type IgAccount } from "@/server/db/schema";
import { GraphApiError } from "@/server/instagram/errors";
import { processCommentEvent, type PipelineDeps } from "@/server/pipeline/process-comment";
import { usagePeriod } from "@/server/usage";
import { resetDb } from "../helpers/db";
import { createAutomation, createEvent, createIgAccount, createUser, setPlan } from "../helpers/factories";
import { FakeGraphClient } from "../helpers/fake-graph";

let graph: FakeGraphClient;
let authFailures: IgAccount[];

function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    db: getDb(),
    graph,
    now: () => new Date(),
    random: () => 0,
    sleep: async () => {},
    appUrl: "https://app.test",
    hourlyLimit: 700,
    decryptToken: decryptSecret,
    onAuthFailure: async (a) => {
      authFailures.push(a);
    },
    ...overrides,
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

async function eventRow(id: string) {
  const [row] = await getDb().select().from(commentEvents).where(eq(commentEvents.id, id));
  return row;
}

async function world(plan: "free" | "pro" = "free") {
  const u = await createUser();
  if (plan !== "free") await setPlan(u.id, plan);
  const acct = await createIgAccount(u.id, { nextReplyAt: new Date(Date.now() - 60_000) });
  const auto = await createAutomation(acct);
  return { u, acct, auto };
}

describe("processCommentEvent", () => {
  beforeEach(async () => {
    await resetDb();
    graph = new FakeGraphClient();
    authFailures = [];
  });

  it("sends a public reply and a button DM on keyword match (free plan)", async () => {
    const { acct, auto, u } = await world();
    const ev = await createEvent(acct, { commentText: "공구요!!" });
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("succeeded");

    expect(graph.replies).toEqual([{ token: `token-${acct.igUserId}`, commentId: ev.commentId, message: "@follower1 DM 확인해주세요!" }]);
    expect(graph.dms).toHaveLength(1);
    const dm = graph.dms[0];
    expect(dm.igUserId).toBe(acct.igUserId);
    expect(dm.message).toMatchObject({ kind: "button", buttonTitle: "구매하기", url: "https://shop.example.com/p/1" });
    expect(dm.message.text).toContain("구매 링크 보내드려요");
    expect(dm.message.text).toContain("무료 댓글 자동 DM · 링포");

    const row = await eventRow(ev.id);
    expect(row).toMatchObject({ status: "succeeded", automationId: auto.id, replyStatus: "sent", dmStatus: "sent", replyCommentId: "reply-1" });
    const [usage] = await getDb().select().from(usageCounters).where(eq(usageCounters.userId, u.id));
    expect(usage.dmCount).toBe(1);
    expect(await getDb().select().from(deliveries)).toHaveLength(1);
  });

  it("wraps the DM link in a tracked short link on pro, without branding", async () => {
    const { acct } = await world("pro");
    const ev = await createEvent(acct);
    await processCommentEvent(deps(), await claim(ev.id));
    const msg = graph.dms[0].message;
    expect(msg.kind).toBe("button");
    if (msg.kind !== "button") throw new Error("unreachable");
    expect(msg.url).toMatch(/^https:\/\/app\.test\/l\/[0-9A-Za-z]{7}$/);
    expect(msg.text).not.toContain("자동 발송");
    const [link] = await getDb().select().from(links);
    expect(link.targetUrl).toBe("https://shop.example.com/p/1");
    expect(link.eventId).toBe(ev.id);
  });

  it("skips comments that match no automation", async () => {
    const { acct } = await world();
    const ev = await createEvent(acct, { commentText: "예뻐요" });
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("skipped");
    expect((await eventRow(ev.id)).skipReason).toBe("no_match");
    expect(graph.replies).toHaveLength(0);
  });

  it.each([
    ["by commenter id", (a: IgAccount) => ({ commenterIgId: a.igUserId })],
    ["by username", (a: IgAccount) => ({ commenterUsername: a.username.toUpperCase() })],
  ])("skips the account's own comments %s", async (_label, patch) => {
    const { acct } = await world();
    const ev = await createEvent(acct, patch(acct));
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("skipped");
    expect((await eventRow(ev.id)).skipReason).toBe("self");
    expect(graph.replies).toHaveLength(0);
  });

  it("skips a webhook for a reply we posted ourselves", async () => {
    const { acct } = await world();
    const first = await createEvent(acct);
    await processCommentEvent(deps(), await claim(first.id));
    const echo = await createEvent(acct, { commentId: "reply-1", commenterIgId: "someone-else", commenterUsername: null, commentText: "@follower1 공구 DM 확인" });
    expect(await processCommentEvent(deps(), await claim(echo.id))).toBe("skipped");
    expect((await eventRow(echo.id)).skipReason).toBe("self");
    expect(graph.replies).toHaveLength(1);
  });

  it("sends only once per commenter, media and automation", async () => {
    const { acct } = await world();
    const e1 = await createEvent(acct);
    const e2 = await createEvent(acct, { commentText: "공구 저도요" });
    await processCommentEvent(deps(), await claim(e1.id));
    expect(await processCommentEvent(deps(), await claim(e2.id))).toBe("skipped");
    expect((await eventRow(e2.id)).skipReason).toBe("duplicate");
    expect(graph.dms).toHaveLength(1);
  });

  it("stops at the monthly DM quota and releases the dedupe reservation", async () => {
    const { acct, u } = await world();
    await getDb().insert(usageCounters).values({ userId: u.id, period: usagePeriod(new Date()), dmCount: PLANS.free.monthlyDmLimit });
    const ev = await createEvent(acct);
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("skipped");
    expect((await eventRow(ev.id)).skipReason).toBe("quota");
    expect(await getDb().select().from(deliveries)).toHaveLength(0);
  });

  it("returns a far-future slot to the queue instead of waiting", async () => {
    const { acct } = await world();
    const slot = new Date(Date.now() + 60_000);
    await getDb().update(igAccounts).set({ nextReplyAt: slot }).where(eq(igAccounts.id, acct.id));
    const ev = await createEvent(acct);
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("deferred");
    const row = await eventRow(ev.id);
    expect(row).toMatchObject({ status: "pending", attempts: 0 });
    expect(row.runAt.getTime()).toBe(slot.getTime());
    expect(row.dmReservedAt?.getTime()).toBe(slot.getTime());
    expect(graph.replies).toHaveLength(0);

    await getDb().update(commentEvents).set({ runAt: new Date() }).where(eq(commentEvents.id, ev.id));
    const later = deps({ now: () => new Date(slot.getTime() + 10) });
    expect(await processCommentEvent(later, await claim(ev.id))).toBe("succeeded");
  });

  it("retries a transient DM failure without re-sending the reply", async () => {
    const { acct } = await world();
    let calls = 0;
    graph.dmError = () => (calls++ === 0 ? new GraphApiError("down", 503) : null);
    const ev = await createEvent(acct);
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("retry");
    let row = await eventRow(ev.id);
    expect(row).toMatchObject({ status: "pending", replyStatus: "sent", dmStatus: null, dmReservedAt: null, errorCode: "http_503" });
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now() + 20_000);

    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("succeeded");
    expect(graph.replies).toHaveLength(1);
    expect(graph.dms).toHaveLength(1);
    row = await eventRow(ev.id);
    expect(row.errorCode).toBeNull();
  });

  it("marks partial and releases reservations on a permanent DM error", async () => {
    const { acct, u } = await world();
    graph.dmError = () => new GraphApiError("cannot receive", 400, 551);
    const ev = await createEvent(acct);
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("partial");
    expect(await eventRow(ev.id)).toMatchObject({ replyStatus: "sent", dmStatus: "failed", errorCode: "551" });
    expect(await getDb().select().from(deliveries)).toHaveLength(0);
    const [usage] = await getDb().select().from(usageCounters).where(eq(usageCounters.userId, u.id));
    expect(usage.dmCount).toBe(0);
  });

  it("falls back to a text DM when the button template is rejected and remembers it", async () => {
    const { acct } = await world();
    graph.dmError = (m) => (m.kind === "button" ? new GraphApiError("invalid", 400, 100, 2534015) : null);
    const e1 = await createEvent(acct);
    expect(await processCommentEvent(deps(), await claim(e1.id))).toBe("succeeded");
    expect(graph.dms[0].message.kind).toBe("text");
    expect(graph.dms[0].message.text).toContain("구매하기: https://shop.example.com/p/1");
    const [a] = await getDb().select().from(igAccounts).where(eq(igAccounts.id, acct.id));
    expect(a.dmFormat).toBe("text");
  });

  it("flags the account for reauth on an invalid token and does not DM", async () => {
    const { acct } = await world();
    graph.replyError = () => new GraphApiError("expired", 400, 190);
    const ev = await createEvent(acct);
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("failed");
    expect(graph.dms).toHaveLength(0);
    const [a] = await getDb().select().from(igAccounts).where(eq(igAccounts.id, acct.id));
    expect(a.status).toBe("reauth_required");
    expect(authFailures).toHaveLength(1);
    expect((await eventRow(ev.id)).errorCode).toBe("190");
  });

  it("waits 5 minutes on rate limits without spending an attempt", async () => {
    const { acct } = await world();
    graph.replyError = () => new GraphApiError("limit", 400, 613, 2534040);
    graph.dmError = () => new GraphApiError("limit", 400, 613, 2534040);
    const ev = await createEvent(acct);
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("retry");
    const row = await eventRow(ev.id);
    expect(row.attempts).toBe(0);
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
  });

  it("fails after the last transient attempt", async () => {
    const { acct } = await world();
    graph.replyError = () => new GraphApiError("down", 500);
    graph.dmError = () => new GraphApiError("down", 500);
    const ev = await createEvent(acct, { attempts: 4 });
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("failed");
    expect(await eventRow(ev.id)).toMatchObject({ status: "failed", replyStatus: "failed", dmStatus: "failed" });
  });

  it("expires events older than 7 days without calling Instagram", async () => {
    const { acct } = await world();
    const ev = await createEvent(acct, { receivedAt: new Date(Date.now() - 8 * 86_400_000) });
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("expired");
    expect(graph.replies).toHaveLength(0);
    expect((await eventRow(ev.id)).errorCode).toBe("expired");
  });

  describe("an event whose DM already went out and only the reply is being retried", () => {
    async function dmSentEvent(receivedAt = new Date()) {
      const { u, acct, auto } = await world();
      const period = usagePeriod(new Date());
      await getDb().insert(usageCounters).values({ userId: u.id, period, dmCount: 1 });
      const ev = await createEvent(acct, { receivedAt, automationId: auto.id, usagePeriod: period, dmStatus: "sent", replyStatus: null });
      await getDb().insert(deliveries).values({ automationId: auto.id, mediaId: ev.mediaId, commenterIgId: ev.commenterIgId, eventId: ev.id });
      return { u, acct, auto, ev };
    }
    async function expectReservationsKept(userId: string) {
      expect(await getDb().select().from(deliveries)).toHaveLength(1);
      const [usage] = await getDb().select().from(usageCounters).where(eq(usageCounters.userId, userId));
      expect(usage.dmCount).toBe(1);
    }

    it("ends as partial and keeps its reservations when it expires", async () => {
      const { u, ev } = await dmSentEvent(new Date(Date.now() - 8 * 86_400_000));
      expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("partial");
      expect(await eventRow(ev.id)).toMatchObject({ status: "partial", dmStatus: "sent" });
      await expectReservationsKept(u.id);
    });

    it("ends as partial and keeps its reservations when the automation was turned off", async () => {
      const { u, auto, ev } = await dmSentEvent();
      await getDb().update(automations).set({ isActive: false }).where(eq(automations.id, auto.id));
      expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("partial");
      await expectReservationsKept(u.id);
    });

    it("ends as partial and keeps its reservations when the account needs reauth", async () => {
      const { u, acct, ev } = await dmSentEvent();
      await getDb().update(igAccounts).set({ status: "reauth_required" }).where(eq(igAccounts.id, acct.id));
      expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("partial");
      await expectReservationsKept(u.id);
    });
  });

  it("binds a 'next post' automation to media published after it was created", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id, { nextReplyAt: new Date(Date.now() - 60_000) });
    const auto = await createAutomation(acct, { mediaScope: "next", createdAt: new Date(Date.now() - 3_600_000) });
    graph.media["new-post"] = {
      id: "new-post",
      caption: "공구 오픈",
      mediaType: "VIDEO",
      mediaProductType: "REELS",
      thumbnailUrl: "https://thumb",
      mediaUrl: null,
      permalink: "https://instagram.com/p/x",
      timestamp: new Date(),
    };
    const ev = await createEvent(acct, { mediaId: "new-post" });
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("succeeded");
    const [bound] = await getDb().select().from(automations).where(eq(automations.id, auto.id));
    expect(bound).toMatchObject({ mediaScope: "specific", mediaId: "new-post", mediaPermalink: "https://instagram.com/p/x" });
  });

  it("does not bind 'next post' to media published before the automation", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createAutomation(acct, { mediaScope: "next" });
    graph.media["old-post"] = {
      id: "old-post", caption: null, mediaType: "IMAGE", mediaProductType: "FEED", thumbnailUrl: null, mediaUrl: null, permalink: null,
      timestamp: new Date(Date.now() - 86_400_000),
    };
    const ev = await createEvent(acct, { mediaId: "old-post" });
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("skipped");
  });

  it("replies to the parent comment when the trigger is itself a reply", async () => {
    const { acct } = await world();
    const ev = await createEvent(acct, { parentCommentId: "parent-1" });
    await processCommentEvent(deps(), await claim(ev.id));
    expect(graph.replies[0].commentId).toBe("parent-1");
    expect(graph.dms[0].commentId).toBe(ev.commentId);
  });

  it("sends only the DM when public replies are disabled", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createAutomation(acct, { replyEnabled: false, replyTexts: [] });
    const ev = await createEvent(acct);
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("succeeded");
    expect(graph.replies).toHaveLength(0);
    expect(await eventRow(ev.id)).toMatchObject({ replyStatus: "skipped", dmStatus: "sent" });
  });

  it("responds to any comment when the automation uses the 'any' match type", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id, { nextReplyAt: new Date(Date.now() - 60_000) });
    await createAutomation(acct, { matchType: "any", keywords: [] });
    const ev = await createEvent(acct, { commentText: "너무 예뻐요" });
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("succeeded");
    expect(graph.dms).toHaveLength(1);
  });
});
