import type { Plan } from "@/lib/plans";
import { brandingLine, buildTextFallback, truncateChars } from "@/server/automations/render";
import type { Automation, CommentEvent } from "@/server/db/schema";
import type { PrivateReplyMessage } from "@/server/instagram/graph";
import { getOrCreateEventLink } from "@/server/links";
import type { PipelineDeps } from "./process-comment";

const BUTTON_TEXT_MAX = 640;

/** 링크 DM 본문. 버튼형이 기본이고, 버튼이 거절되면 쓸 글자형도 함께 만든다 */
export async function buildLinkDm(
  deps: Pick<PipelineDeps, "db" | "appUrl">,
  p: { automation: Automation; event: CommentEvent; plan: Plan },
): Promise<{ button: PrivateReplyMessage; text: PrivateReplyMessage }> {
  const { automation, event, plan } = p;
  const url = plan.linkTracking
    ? `${deps.appUrl}/l/${await getOrCreateEventLink(deps.db, {
        eventId: event.id,
        automationId: automation.id,
        targetUrl: automation.dmLinkUrl,
      })}`
    : automation.dmLinkUrl;
  const body = plan.branding ? `${automation.dmText}\n\n${brandingLine()}` : automation.dmText;
  return {
    button: { kind: "button", text: truncateChars(body, BUTTON_TEXT_MAX), buttonTitle: automation.dmButtonTitle, url },
    text: { kind: "text", text: buildTextFallback(body, automation.dmButtonTitle, url) },
  };
}
