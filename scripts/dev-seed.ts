/**
 * 개발용 예시 데이터: 가장 최근에 가입한 사용자에게 인스타 계정·자동화·발송 기록을 만든다.
 * 사용: pnpm tsx --env-file=.env scripts/dev-seed.ts
 */
import { desc, eq } from "drizzle-orm";
import { encryptSecret } from "../src/server/crypto";
import { createDb } from "../src/server/db/client";
import { automations, commentEvents, igAccounts, links, user } from "../src/server/db/schema";

async function main() {
  const { db, sql } = createDb(process.env.DATABASE_URL ?? "", { max: 1 });
  const [u] = await db.select().from(user).orderBy(desc(user.createdAt)).limit(1);
  if (!u) throw new Error("먼저 /login 으로 가입하세요");
  await db.delete(igAccounts).where(eq(igAccounts.userId, u.id));
  const [acct] = await db
    .insert(igAccounts)
    .values({
      userId: u.id,
      igUserId: "17841400000000001",
      igScopedId: "dev-scoped-1",
      username: "hana.living",
      accountType: "BUSINESS",
      accessTokenEnc: encryptSecret("fake-token"),
      tokenExpiresAt: new Date(Date.now() + 50 * 86_400_000),
    })
    .returning();
  const [a1] = await db
    .insert(automations)
    .values({
      userId: u.id,
      igAccountId: acct.id,
      name: "10월 텀블러 공구",
      mediaScope: "all",
      keywords: ["공구", "링크"],
      matchType: "contains",
      replyTexts: ["{username} DM 확인해주세요!", "{username} DM으로 링크 보내드렸어요", "{username} 메시지함을 확인해주세요"],
      dmText: "요청하신 텀블러 공구 링크예요. 10월 31일까지 공구가로 만나보세요.",
      dmButtonTitle: "구매하러 가기",
      dmLinkUrl: "https://shop.example.com/tumbler",
      isActive: true,
    })
    .returning();
  await db.insert(automations).values({
    userId: u.id,
    igAccountId: acct.id,
    name: "프로필 링크 안내",
    mediaScope: "next",
    keywords: [],
    matchType: "any",
    replyTexts: ["{username} DM 확인해주세요!"],
    dmText: "프로필 링크 모음이에요.",
    dmButtonTitle: "링크 열기",
    dmLinkUrl: "https://shop.example.com",
    isActive: false,
  });
  const now = Date.now();
  const rows = [
    { u: "jiwoo.daily", t: "공구 링크 주세요!", s: "succeeded" as const, m: 2 },
    { u: "minseo_k", t: "공구요 저도요", s: "succeeded" as const, m: 3 },
    { u: "dahye.home", t: "공구!", s: "partial" as const, m: 5, e: "551" },
    { u: "jiwoo.daily", t: "링크 한 번 더요", s: "skipped" as const, m: 6, skip: "duplicate" as const },
    { u: "sooah.log", t: "공구 참여할게요", s: "succeeded" as const, m: 8 },
  ];
  for (const [i, r] of rows.entries()) {
    const [ev] = await db
      .insert(commentEvents)
      .values({
        igAccountId: acct.id,
        automationId: a1.id,
        commentId: `dev-${now}-${i}`,
        mediaId: "dev-media",
        commenterIgId: `dev-${r.u}`,
        commenterUsername: r.u,
        commentText: r.t,
        status: r.s,
        skipReason: r.skip ?? null,
        errorCode: r.e ?? null,
        createdAt: new Date(now - r.m * 60_000),
        completedAt: new Date(now - r.m * 60_000),
      })
      .returning();
    if (r.s === "succeeded") {
      await db.insert(links).values({ code: `dev${i}${String(now).slice(-4)}`, automationId: a1.id, eventId: ev.id, targetUrl: a1.dmLinkUrl, clickCount: i % 2 });
    }
  }
  console.log(`seeded for ${u.email}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
