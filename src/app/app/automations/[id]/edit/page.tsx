import { and, eq, ne } from "drizzle-orm";
import { notFound } from "next/navigation";
import { AutomationWizard } from "@/components/app/automation-wizard";
import { brandingLine } from "@/server/automations/render";
import { getAutomation } from "@/server/automations/service";
import { getUserPlan } from "@/server/billing/plan-of";
import { getDb } from "@/server/db/client";
import { igAccounts } from "@/server/db/schema";
import { requireUser } from "@/server/session";

export const metadata = { title: "자동화 수정" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = getDb();
  const auto = UUID.test(id) ? await getAutomation(db, user.id, id) : null;
  if (!auto) notFound();
  const accounts = await db
    .select({ id: igAccounts.id, username: igAccounts.username })
    .from(igAccounts)
    .where(and(eq(igAccounts.userId, user.id), ne(igAccounts.status, "disconnected")));
  const plan = await getUserPlan(db, user.id);
  return (
    <AutomationWizard
      automationId={auto.id}
      accounts={accounts}
      branding={plan.branding ? brandingLine() : null}
      linkTracking={plan.linkTracking}
      initial={{
        igAccountId: auto.igAccountId,
        name: auto.name,
        mediaScope: auto.mediaScope,
        media: auto.mediaId
          ? { id: auto.mediaId, thumbnailUrl: auto.mediaThumbnailUrl, permalink: auto.mediaPermalink, caption: auto.mediaCaption }
          : null,
        keywords: auto.keywords,
        matchType: auto.matchType,
        replyEnabled: auto.replyEnabled,
        replyTexts: auto.replyTexts,
        dmText: auto.dmText,
        dmButtonTitle: auto.dmButtonTitle,
        dmLinkUrl: auto.dmLinkUrl,
      }}
    />
  );
}
