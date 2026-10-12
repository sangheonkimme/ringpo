"use client";

import { CreditCard, Home, SlidersHorizontal, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { isWizardPath } from "./routes";

const items = [
  { href: "/app", label: "홈", icon: Home, exact: true },
  { href: "/app/automations", label: "자동화", icon: Zap, exact: false },
  { href: "/app/billing", label: "결제", icon: CreditCard, exact: false },
  { href: "/app/settings", label: "설정", icon: SlidersHorizontal, exact: false },
];

function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit"].includes(el.type);
}

/** 입력 중(모바일 키보드가 열린 동안)에는 아래 탭을 숨겨 입력창과 버튼이 보일 자리를 남긴다 */
function useTyping(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const update = () => setTyping(isTextEntry(document.activeElement));
    // focusout 시점엔 아직 다음 요소로 초점이 옮겨지기 전이라 한 박자 뒤에 확인한다
    const later = () => setTimeout(update, 0);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", later);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", later);
    };
  }, []);
  return typing;
}

export function AppNav() {
  const pathname = usePathname();
  const typing = useTyping();
  if (isWizardPath(pathname) || typing) return null;
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
