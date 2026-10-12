import { and, eq, sql } from "drizzle-orm";
import { DEFAULT_FOLLOW_GATE_TEXT } from "@/lib/automation-schema";
import { getUserPlan } from "@/server/billing/plan-of";
import { automations, commentEvents, followGates, igAccounts, type Automation, type CommentEvent, type IgAccount } from "@/server/db/schema";
import { classifyError } from "@/server/instagram/errors";
import type { PrivateReplyMessage } from "@/server/instagram/graph";
import { FOLLOW_GATE_PAYLOAD_PREFIX, type FollowTap } from "@/server/instagram/webhook";
import { log } from "@/server/log";
import { buildLinkDm } from "./dm-content";
import type { PipelineDeps } from "./process-comment";

export const FOLLOW_GATE_BUTTON = "팔로우했어요";
const RETRY_TEXT = "아직 팔로우가 확인되지 않았어요 🙏\n팔로우한 뒤 아래 버튼을 다시 눌러 주세요.";
const CONSENT_TEXT = "팔로우를 확인하려면 아래 버튼을 한 번만 더 눌러 주세요 🙏";

/** 기본은 말풍선 안 버튼(postback). kind "gate"는 입력창 위에 뜨는 빠른 답장 */
function gateMessage(text: string, gateId: string, kind: "gate" | "gate_button" = "gate_button"): PrivateReplyMessage {
  return { kind, text, buttonTitle: FOLLOW_GATE_BUTTON, payload: `${FOLLOW_GATE_PAYLOAD_PREFIX}${gateId}` };
}

/** 말풍선 안 버튼이 거절되면(형식 오류) 같은 내용을 빠른 답장으로 다시 보낸다 */
async function sendWithFallback(send: (m: PrivateReplyMessage) => Promise<{ messageId: string }>, message: PrivateReplyMessage) {
  try {
    return await send(message);
  } catch (e) {
    const c = classifyError(e);
    if (message.kind !== "gate_button" || !(c.cls === "invalid_message" || c.code.startsWith("100"))) throw e;
    return send({ ...message, kind: "gate" });
  }
}

/** 댓글에 대한 비공개 답장으로 '팔로우했어요' 버튼이 달린 안내를 보낸다. 재시도 때는 같은 대기 건을 다시 쓴다 */
export async function sendFollowGate(
  deps: PipelineDeps,
  p: { account: IgAccount; automation: Automation; event: CommentEvent; token: string },
): Promise<{ messageId: string }> {
  const { db, graph } = deps;
  await db.insert(followGates).values({ eventId: p.event.id, igAccountId: p.account.id }).onConflictDoNothing({ target: followGates.eventId });
  const [gate] = await db.select({ id: followGates.id }).from(followGates).where(eq(followGates.eventId, p.event.id));
  const text = p.automation.followGateText.trim() || DEFAULT_FOLLOW_GATE_TEXT;
  return sendWithFallback((m) => graph.sendPrivateReply(p.token, p.account.igUserId, p.event.commentId, m), gateMessage(text, gate.id));
}

export type FollowTapOutcome = "sent" | "not_following" | "needs_consent" | "ignored" | "failed";

/** '팔로우했어요'를 누른 사람의 팔로우를 확인해, 팔로우 중이면 링크 DM을 보내고 아니면 다시 안내한다 */
export async function handleFollowTap(deps: PipelineDeps, tap: FollowTap): Promise<FollowTapOutcome> {
  const { db, graph } = deps;
  const [gate] = await db.select().from(followGates).where(eq(followGates.id, tap.gateId));
  if (!gate || gate.status !== "waiting") return "ignored";
  const [account] = await db.select().from(igAccounts).where(eq(igAccounts.id, gate.igAccountId));
  if (!account || account.igUserId !== tap.igUserId || account.status !== "active" || !account.accessTokenEnc) return "ignored";
  const [event] = await db.select().from(commentEvents).where(eq(commentEvents.id, gate.eventId));
  if (!event || event.status !== "awaiting_follow" || !event.automationId) return "ignored";
  const [automation] = await db.select().from(automations).where(eq(automations.id, event.automationId));
  if (!automation) return "ignored";

  const token = deps.decryptToken(account.accessTokenEnc);
  await db
    .update(followGates)
    .set({ checks: sql`${followGates.checks} + 1`, senderId: tap.senderId })
    .where(eq(followGates.id, gate.id));

  const send = (m: PrivateReplyMessage) => graph.sendMessage(token, account.igUserId, tap.senderId, m);
  let following: boolean;
  try {
    following = await graph.isFollower(token, tap.senderId);
  } catch (e) {
    const c = classifyError(e);
    log.warn("follow check failed", { gateId: gate.id, code: c.code });
    if (c.cls === "transient" || c.cls === "rate_limited") return "failed";
    // 말풍선 버튼 탭이 '메시지를 보낸 것'으로 인정되지 않으면 조회가 거절된다. 빠른 답장은 메시지로 인정되므로 그걸로 한 번 더 받는다
    try {
      await send(gateMessage(CONSENT_TEXT, gate.id, "gate"));
    } catch {
      return "failed";
    }
    return "needs_consent";
  }

  if (!following) {
    try {
      await sendWithFallback(send, gateMessage(RETRY_TEXT, gate.id));
    } catch (e) {
      log.warn("follow gate retry failed", { gateId: gate.id, code: classifyError(e).code });
      return "failed";
    }
    return "not_following";
  }

  // 같은 버튼을 여러 번 눌러도 링크는 한 번만 나가도록 먼저 차지한다
  const [claimed] = await db
    .update(followGates)
    .set({ status: "sent", completedAt: deps.now() })
    .where(and(eq(followGates.id, gate.id), eq(followGates.status, "waiting")))
    .returning({ id: followGates.id });
  if (!claimed) return "ignored";

  const plan = await getUserPlan(db, account.userId);
  const dm = await buildLinkDm(deps, { automation, event, plan });
  let messageId: string;
  try {
    try {
      messageId = (await send(dm.button)).messageId;
    } catch (e) {
      if (classifyError(e).cls !== "invalid_message") throw e;
      messageId = (await send(dm.text)).messageId;
    }
  } catch (e) {
    await db.update(followGates).set({ status: "waiting", completedAt: null }).where(eq(followGates.id, gate.id));
    log.warn("follow gate link failed", { gateId: gate.id, code: classifyError(e).code });
    return "failed";
  }

  await db
    .update(commentEvents)
    .set({
      status: event.replyStatus === "failed" ? "partial" : "succeeded",
      dmStatus: "sent",
      dmMessageId: messageId,
      completedAt: deps.now(),
    })
    .where(eq(commentEvents.id, event.id));
  return "sent";
}
