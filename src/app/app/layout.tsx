import { AppHeader } from "@/components/app/app-header";
import { AppNav } from "@/components/app/app-nav";
import { requireUser } from "@/server/session";
import { campaignAccounts } from "@/server/campaigns/access";
import { getDb } from "@/server/db/client";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const campaignsAvailable = (await campaignAccounts(getDb(), user.id)).length > 0;
  return (
    <div className="min-h-dvh bg-background">
      <AppHeader />
      <div className="mx-auto max-w-lg">{children}</div>
      <AppNav campaignsAvailable={campaignsAvailable} />
    </div>
  );
}
