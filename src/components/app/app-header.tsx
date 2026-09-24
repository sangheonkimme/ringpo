"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
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
        {/^\/app\/automations\/[^/]+$/.test(pathname) && pathname !== "/app/automations/new" ? (
          <Link href="/app/automations" className="-ml-3 flex h-11 items-center gap-0.5 px-2 text-[15px] font-semibold">
            <ChevronLeft className="size-[22px]" aria-hidden />
            자동화
          </Link>
        ) : (
          <Logo href="/app" />
        )}
        <SignOutButton />
      </div>
    </header>
  );
}
