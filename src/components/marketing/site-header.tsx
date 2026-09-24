import Link from "next/link";
import { Logo } from "@/components/brand/logo";

const links = [
  { href: "/#how", label: "사용 방법" },
  { href: "/#pricing", label: "요금" },
  { href: "/#faq", label: "자주 묻는 질문" },
  { href: "/login", label: "로그인" },
];

export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 md:h-20 md:px-20">
        <Logo href="/" size="responsive" />
        <nav aria-label="사이트 메뉴" className="flex items-center gap-1">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hidden px-4 py-3 text-[15px] font-medium hover:text-brand-ink md:block">
              {l.label}
            </Link>
          ))}
          <Link
            href="/login"
            className="ml-2 flex h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground md:px-[22px] md:text-[15px]"
          >
            무료로 시작
          </Link>
        </nav>
      </div>
    </header>
  );
}
