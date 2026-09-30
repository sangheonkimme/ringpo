import { and, eq, ne, sql } from "drizzle-orm";
import { getUserPlan } from "@/server/billing/plan-of";
import type { Db } from "@/server/db/client";
import { igAccounts } from "@/server/db/schema";
import { errorFields, log } from "@/server/log";
import { deleteIgAccounts } from "./meta-callbacks";
import type { GraphClient, IgProfile } from "./graph";

export const IG_STATE_COOKIE = "ig_oauth_state";

export interface ConnectDeps {
  db: Db;
  graph: GraphClient;
  exchangeCode: (code: string) => Promise<{ accessToken: string }>;
  exchangeLongLived: (shortToken: string) => Promise<{ accessToken: string; expiresIn: number }>;
  encrypt: (plain: string) => string;
  now: () => Date;
}

export type ConnectResult =
  | { ok: true; accountId: string }
  | { ok: false; reason: "oauth_failed" | "not_professional" | "owned_by_other" | "limit" | "subscribe_failed" };

export async function connectInstagramAccount(
  deps: ConnectDeps,
  p: { userId: string; code: string },
): Promise<ConnectResult> {
  const { db } = deps;
  let token: { accessToken: string; expiresIn: number };
  let profile: IgProfile;
  try {
    const short = await deps.exchangeCode(p.code);
    token = await deps.exchangeLongLived(short.accessToken);
    profile = await deps.graph.getMe(token.accessToken);
  } catch (e) {
    log.warn("instagram oauth failed", errorFields(e));
    return { ok: false, reason: "oauth_failed" };
  }

  const accountType = profile.accountType.toUpperCase();
  if (accountType !== "BUSINESS" && accountType !== "MEDIA_CREATOR") return { ok: false, reason: "not_professional" };

  let existing: typeof igAccounts.$inferSelect | undefined;
  [existing] = await db.select().from(igAccounts).where(eq(igAccounts.igUserId, profile.userId)).limit(1);
  if (existing && existing.userId !== p.userId) {
    if (existing.status !== "disconnected") return { ok: false, reason: "owned_by_other" };
    // 이전 소유자가 연결을 끊은 계정은 새 사용자가 가져간다. 이전 소유자의 자동화·기록은 함께 지운다(cascade)
    await deleteIgAccounts(db, [existing.id]);
    existing = undefined;
  }

  if (!existing || existing.status === "disconnected") {
    const plan = await getUserPlan(db, p.userId);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(igAccounts)
      .where(and(eq(igAccounts.userId, p.userId), ne(igAccounts.status, "disconnected")));
    if (count >= plan.maxIgAccounts) return { ok: false, reason: "limit" };
  }

  const now = deps.now();
  const fields = {
    igScopedId: profile.id,
    username: profile.username,
    profilePictureUrl: profile.profilePictureUrl,
    accountType,
    accessTokenEnc: deps.encrypt(token.accessToken),
    tokenExpiresAt: new Date(now.getTime() + token.expiresIn * 1000),
    status: "active" as const,
  };
  const [row] = await db
    .insert(igAccounts)
    .values({ userId: p.userId, igUserId: profile.userId, ...fields })
    .onConflictDoUpdate({ target: igAccounts.igUserId, set: fields, setWhere: eq(igAccounts.userId, p.userId) })
    .returning({ id: igAccounts.id });
  if (!row) return { ok: false, reason: "owned_by_other" };

  try {
    await deps.graph.subscribeApp(token.accessToken, profile.userId);
  } catch (e) {
    log.warn("instagram webhook subscription failed", { igAccountId: row.id, ...errorFields(e) });
    return { ok: false, reason: "subscribe_failed" };
  }
  return { ok: true, accountId: row.id };
}
