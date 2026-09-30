import { AppHeader } from "@/components/app/app-header";
import { AppNav } from "@/components/app/app-nav";
import { requireUser } from "@/server/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <div className="min-h-dvh bg-background">
      <AppHeader />
      <div className="mx-auto max-w-lg">{children}</div>
      <AppNav />
    </div>
  );
}
