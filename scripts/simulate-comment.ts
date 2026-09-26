import { createHmac, randomInt } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "ig-user-id": { type: "string" },
    "media-id": { type: "string", default: "sim-media-1" },
    text: { type: "string", default: "공구" },
    "comment-id": { type: "string" },
    "from-id": { type: "string" },
    username: { type: "string", default: "sim_follower" },
    url: { type: "string" },
  },
});

const secret = process.env.IG_APP_SECRET;
const igUserId = values["ig-user-id"];
if (!secret || !igUserId) {
  console.error("usage: IG_APP_SECRET=... pnpm simulate:comment --ig-user-id <IG 프로페셔널 계정 ID> [--text 공구] [--media-id ..] [--comment-id ..] [--url http://localhost:3000]");
  process.exit(1);
}

const body = JSON.stringify({
  object: "instagram",
  entry: [
    {
      id: igUserId,
      time: Math.floor(Date.now() / 1000),
      changes: [
        {
          field: "comments",
          value: {
            from: { id: values["from-id"] ?? `sim-${randomInt(1_000_000_000)}`, username: values.username },
            media: { id: values["media-id"], media_product_type: "REELS" },
            id: values["comment-id"] ?? `sim-${Date.now()}`,
            text: values.text,
          },
        },
      ],
    },
  ],
});

const target = `${values.url ?? process.env.APP_URL ?? "http://localhost:3000"}/api/webhooks/instagram`;

// tsx는 package.json에 type:module이 없어 CJS로 변환하므로 top-level await를 쓰지 않는다
async function main() {
  const res = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", secret!).update(body).digest("hex")}` },
    body,
  });
  console.log(res.status, await res.text());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
