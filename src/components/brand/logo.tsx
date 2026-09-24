import Link from "next/link";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

const BUBBLE =
  "M12 3C7 3 3 6.6 3 11c0 2.4 1.2 4.6 3.1 6.1L5 21l4.3-2.2c.9.2 1.8.3 2.7.3 5 0 9-3.6 9-8s-4-8-9-8z";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("flex size-7 items-center justify-center rounded-[8px] bg-foreground", className)}>
      <svg viewBox="0 0 24 24" className="size-[57%] fill-brand">
        <path d={BUBBLE} />
      </svg>
    </span>
  );
}

const MARK = { md: "", lg: "size-9 rounded-[10px]", responsive: "md:size-[34px] md:rounded-[10px]" } as const;
const TEXT = { md: "text-[19px]", lg: "text-2xl", responsive: "text-[19px] md:text-2xl" } as const;

export function Logo({ href, size = "md" }: { href: string; size?: keyof typeof MARK }) {
  return (
    <Link href={href} className="flex items-center gap-2 text-foreground md:gap-2.5">
      <LogoMark className={MARK[size]} />
      <span className={cn("font-display font-extrabold tracking-[-0.02em]", TEXT[size])}>
        {site.name}
      </span>
    </Link>
  );
}
