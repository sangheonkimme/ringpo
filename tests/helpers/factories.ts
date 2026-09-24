import { randomInt, randomUUID } from "node:crypto";
import { encryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import {
  automations,
  commentEvents,
  igAccounts,
  subscriptions,
  user,
  type Automation,
  type IgAccount,
  type NewAutomation,
  type NewCommentEvent,
} from "@/server/db/schema";

export async function createUser(overrides: Partial<typeof user.$inferInsert> = {}) {
  const id = overrides.id ?? randomUUID();
  const [row] = await getDb()
    .insert(user)
    .values({ id, name: "테스터", email: `${id}@test.local`, ...overrides })
    .returning();
  return row;
}

export function randomIgId(): string {
  return `1784${String(randomInt(10 ** 12)).padStart(13, "0")}`;
}

export async function createIgAccount(
  userId: string,
  overrides: Partial<typeof igAccounts.$inferInsert> = {},
): Promise<IgAccount> {
  const igUserId = overrides.igUserId ?? randomIgId();
  const [row] = await getDb()
    .insert(igAccounts)
    .values({
      userId,
      igUserId,
      igScopedId: `scoped-${igUserId}`,
      username: `creator_${igUserId.slice(-6)}`,
      accountType: "BUSINESS",
      accessTokenEnc: encryptSecret(`token-${igUserId}`),
      tokenExpiresAt: new Date(Date.now() + 50 * 86_400_000),
      ...overrides,
    })
    .returning();
  return row;
}

export async function createAutomation(
  account: IgAccount,
  overrides: Partial<NewAutomation> = {},
): Promise<Automation> {
  const [row] = await getDb()
    .insert(automations)
    .values({
      userId: account.userId,
      igAccountId: account.id,
      name: "공구 자동화",
      mediaScope: "all",
      keywords: ["공구"],
      matchType: "contains",
      replyEnabled: true,
      replyTexts: ["{username} DM 확인해주세요!"],
      dmText: "구매 링크 보내드려요",
      dmButtonTitle: "구매하기",
      dmLinkUrl: "https://shop.example.com/p/1",
      isActive: true,
      ...overrides,
    })
    .returning();
  return row;
}

export async function createEvent(account: IgAccount, overrides: Partial<NewCommentEvent> = {}) {
  const [row] = await getDb()
    .insert(commentEvents)
    .values({
      igAccountId: account.id,
      commentId: randomIgId(),
      mediaId: "media-1",
      commenterIgId: "commenter-1",
      commenterUsername: "follower1",
      commentText: "공구",
      ...overrides,
    })
    .returning();
  return row;
}

export async function setPlan(
  userId: string,
  plan: "free" | "pro" | "agency",
  overrides: Partial<typeof subscriptions.$inferInsert> = {},
) {
  const [row] = await getDb()
    .insert(subscriptions)
    .values({ userId, plan, status: "active", ...overrides })
    .onConflictDoUpdate({ target: subscriptions.userId, set: { plan, status: "active", ...overrides } })
    .returning();
  return row;
}
