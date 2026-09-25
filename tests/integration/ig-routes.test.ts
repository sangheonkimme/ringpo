import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as healthGET } from "@/app/api/health/route";
import { POST as dataDeletionPOST } from "@/app/api/meta/data-deletion/route";
import { POST as deauthPOST } from "@/app/api/meta/deauthorize/route";
import { GET as webhookGET, POST as webhookPOST } from "@/app/api/webhooks/instagram/route";
import { GET as linkGET } from "@/app/l/[code]/route";
import { getDb } from "@/server/db/client";
import { automations, commentEvents, dataDeletionRequests, igAccounts, links, workerHeartbeats } from "@/server/db/schema";
import { resetDb } from "../helpers/db";
import { createAutomation, createEvent, createIgAccount, createUser } from "../helpers/factories";

const BASE = "http://localhost:3000";

function signedWebhook(body: string, secret = "ig-app-secret") {
  return new Request(`${BASE}/api/webhooks/instagram`, {
    method: "POST",
    body,
    headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` },
  });
}

function signedRequest(payload: object, secret = "ig-app-secret") {
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const s = createHmac("sha256", secret).update(p).digest("base64url");
  return `${s}.${p}`;
}

function formPost(path: string, fields: Record<string, string>) {
  return new Request(`${BASE}${path}`, { method: "POST", body: new URLSearchParams(fields) });
}

describe("instagram webhook route", () => {
  beforeEach(resetDb);

  it("answers the verification handshake only with the right token", async () => {
    const ok = await webhookGET(new Request(`${BASE}/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=verify-token-123&hub.challenge=1158201444`));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("1158201444");
    const bad = await webhookGET(new Request(`${BASE}/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`));
    expect(bad.status).toBe(403);
  });

  it("rejects payloads with a bad signature", async () => {
    const res = await webhookPOST(signedWebhook("{}", "wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("queues each comment once, drops self comments and accepts the Meta app secret", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createAutomation(acct);
    const body = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: acct.igUserId,
          time: 1,
          changes: [
            { field: "comments", value: { from: { id: "f1", username: "fan" }, media: { id: "m1" }, id: "c-100", text: "공구" } },
            { field: "comments", value: { from: { id: acct.igUserId, username: acct.username }, media: { id: "m1" }, id: "c-101", text: "DM 확인" } },
          ],
        },
      ],
    });
    expect((await webhookPOST(signedWebhook(body))).status).toBe(200);
    expect((await webhookPOST(signedWebhook(body, "meta-app-secret"))).status).toBe(200);
    const rows = await getDb().select().from(commentEvents);
    expect(rows.map((r) => r.commentId)).toEqual(["c-100"]);
    expect(rows[0]).toMatchObject({ igAccountId: acct.id, commenterUsername: "fan", status: "pending" });
  });

  it("ignores accounts without active automations", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createAutomation(acct, { isActive: false });
    const body = JSON.stringify({
      object: "instagram",
      entry: [{ id: acct.igUserId, changes: [{ field: "comments", value: { from: { id: "f" }, media: { id: "m" }, id: "c-1", text: "공구" } }] }],
    });
    expect((await webhookPOST(signedWebhook(body))).status).toBe(200);
    expect(await getDb().select().from(commentEvents)).toHaveLength(0);
  });
});

describe("meta callbacks", () => {
  beforeEach(resetDb);

  it("deauthorize disconnects the account and turns automations off", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createAutomation(acct);
    const res = await deauthPOST(formPost("/api/meta/deauthorize", { signed_request: signedRequest({ algorithm: "HMAC-SHA256", user_id: acct.igScopedId }) }));
    expect(res.status).toBe(200);
    const [a] = await getDb().select().from(igAccounts).where(eq(igAccounts.id, acct.id));
    expect(a).toMatchObject({ status: "disconnected", accessTokenEnc: null });
    const [auto] = await getDb().select().from(automations);
    expect(auto.isActive).toBe(false);
  });

  it("data deletion removes the account data and returns a status url", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const ev = await createEvent(acct);
    const auto = await createAutomation(acct);
    await getDb().insert(links).values([
      { code: "dd-auto", automationId: auto.id, targetUrl: "https://shop.example.com" },
      { code: "dd-event", eventId: ev.id, targetUrl: "https://shop.example.com" },
    ]);
    const res = await dataDeletionPOST(formPost("/api/meta/data-deletion", { signed_request: signedRequest({ algorithm: "HMAC-SHA256", user_id: acct.igUserId }) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; confirmation_code: string };
    expect(body.url).toBe(`${BASE}/data-deletion/${body.confirmation_code}`);
    expect(await getDb().select().from(igAccounts)).toHaveLength(0);
    expect(await getDb().select().from(commentEvents)).toHaveLength(0);
    expect(await getDb().select().from(links)).toHaveLength(0);
    const [reqRow] = await getDb().select().from(dataDeletionRequests);
    expect(reqRow.status).toBe("completed");
  });

  it("answers 400, not 500, to requests without a form body", async () => {
    for (const [path, handler] of [["/api/meta/deauthorize", deauthPOST], ["/api/meta/data-deletion", dataDeletionPOST]] as const) {
      const res = await handler(new Request(`${BASE}${path}`, { method: "POST" }));
      expect(res.status).toBe(400);
    }
  });

  it("rejects unsigned callback requests", async () => {
    const res = await deauthPOST(formPost("/api/meta/deauthorize", { signed_request: signedRequest({ user_id: "1" }, "wrong") }));
    expect(res.status).toBe(400);
  });
});

describe("short link redirect", () => {
  beforeEach(resetDb);

  it("redirects and counts human clicks, not preview bots", async () => {
    const [row] = await getDb().insert(links).values({ code: "Abc1234", targetUrl: "https://shop.example.com/p/1" }).returning();
    const human = await linkGET(new Request(`${BASE}/l/Abc1234`, { headers: { "user-agent": "Mozilla/5.0 (iPhone) Instagram 350" } }), {
      params: Promise.resolve({ code: "Abc1234" }),
    });
    expect(human.status).toBe(302);
    expect(human.headers.get("location")).toBe("https://shop.example.com/p/1");
    await linkGET(new Request(`${BASE}/l/Abc1234`, { headers: { "user-agent": "facebookexternalhit/1.1" } }), {
      params: Promise.resolve({ code: "Abc1234" }),
    });
    const [after] = await getDb().select().from(links).where(eq(links.id, row.id));
    expect(after.clickCount).toBe(1);
  });

  it("returns 404 for unknown codes", async () => {
    const res = await linkGET(new Request(`${BASE}/l/Nope123`), { params: Promise.resolve({ code: "Nope123" }) });
    expect(res.status).toBe(404);
  });
});

describe("health", () => {
  beforeEach(resetDb);

  it("is healthy without strict mode and requires a fresh worker heartbeat in strict mode", async () => {
    expect((await healthGET(new Request(`${BASE}/api/health`))).status).toBe(200);
    expect((await healthGET(new Request(`${BASE}/api/health?strict=1`))).status).toBe(503);
    await getDb().insert(workerHeartbeats).values({ workerId: "w", beatAt: new Date() });
    expect((await healthGET(new Request(`${BASE}/api/health?strict=1`))).status).toBe(200);
  });
});
