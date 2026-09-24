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

export function Logo({ href, size = "md" }: { href: string; size?: "md" | "lg" }) {
  return (
    <Link href={href} className="flex items-center gap-2 text-foreground">
      <LogoMark className={size === "lg" ? "size-9 rounded-[10px]" : undefined} />
      <span className={cn("font-display font-extrabold tracking-[-0.02em]", size === "lg" ? "text-2xl" : "text-[19px]")}>
        {site.name}
      </span>
    </Link>
  );
}
