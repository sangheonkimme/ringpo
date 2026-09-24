import Link from "next/link";
import { site } from "@/lib/site";

export function SiteFooter() {
  const b = site.business;
  const rows = [
    ["상호", b.companyName],
    ["대표", b.ceo],
    ["사업자등록번호", b.registrationNumber],
    ["통신판매업 신고", b.mailOrderNumber],
    ["주소", b.address],
    ["전화", b.phone],
    ["이메일", site.supportEmail],
  ].filter(([, v]) => v);
  return (
    <footer className="bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-10 md:px-20 md:py-14">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <span className="font-display text-lg font-extrabold md:text-xl">{site.name}</span>
          <nav aria-label="약관" className="flex flex-wrap gap-4 text-[13px] md:gap-6 md:text-sm">
            <Link href="/terms">이용약관</Link>
            <Link href="/privacy" className="font-bold">
              개인정보처리방침
            </Link>
            <Link href="/refund">환불정책</Link>
            <Link href="/pricing">요금</Link>
          </nav>
        </div>
        <p className="text-xs leading-[1.8] text-muted-foreground md:text-[13px]">
          {rows.map(([k, v]) => `${k} ${v}`).join(" · ")}
        </p>
        <p className="text-xs leading-[1.8] text-muted-foreground md:text-[13px]">
          {site.name}은 Meta의 공식 Instagram API만 사용하며 인스타그램 비밀번호를 받거나 저장하지 않아요. Instagram은 Meta
          Platforms, Inc.의 상표입니다. © {new Date().getFullYear()} {b.companyName || site.name}
        </p>
      </div>
    </footer>
  );
}
