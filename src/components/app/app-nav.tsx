"use client";

import { CreditCard, Home, SlidersHorizontal, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isWizardPath } from "./routes";

const items = [
  { href: "/app", label: "홈", icon: Home, exact: true },
  { href: "/app/automations", label: "자동화", icon: Zap, exact: false },
  { href: "/app/billing", label: "결제", icon: CreditCard, exact: false },
  { href: "/app/settings", label: "설정", icon: SlidersHorizontal, exact: false },
];

export function AppNav() {
  const pathname = usePathname();
  if (isWizardPath(pathname)) return null;
  return (
    <nav
      aria-label="주요 메뉴"
      className="fixed inset-x-0 bottom-0 z-20 border-t bg-card pb-[max(env(safe-area-inset-bottom),10px)]"
    >
      <ul className="mx-auto grid h-[66px] max-w-lg grid-cols-4">
        {items.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 text-xs",
                  active ? "font-bold text-foreground shadow-[inset_0_2px_0_var(--foreground)]" : "font-medium text-muted-foreground",
                )}
              >
                <Icon className="size-[22px]" strokeWidth={2} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
