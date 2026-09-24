import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AutomationWizard } from "@/components/app/automation-wizard";
import { brandingLine } from "@/server/automations/render";
import { getUserPlan } from "@/server/billing/plan-of";
import { getDb } from "@/server/db/client";
import { igAccounts } from "@/server/db/schema";
import { requireUser } from "@/server/session";

export const metadata = { title: "새 자동화" };

export default async function NewAutomationPage() {
  const user = await requireUser();
  const db = getDb();
  const accounts = await db
    .select({ id: igAccounts.id, username: igAccounts.username })
    .from(igAccounts)
    .where(and(eq(igAccounts.userId, user.id), eq(igAccounts.status, "active")));
  if (accounts.length === 0) redirect("/app/onboarding");
  const plan = await getUserPlan(db, user.id);
  return <AutomationWizard accounts={accounts} branding={plan.branding ? brandingLine() : null} linkTracking={plan.linkTracking} />;
}
