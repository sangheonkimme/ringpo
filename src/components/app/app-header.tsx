"use client";

import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { isWizardPath } from "./routes";
import { SignOutButton } from "./sign-out-button";

export function AppHeader() {
  const pathname = usePathname();
  if (isWizardPath(pathname)) return null;
  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-lg items-center justify-between pl-5 pr-3">
        <Logo href="/app" />
        <SignOutButton />
      </div>
    </header>
  );
}
