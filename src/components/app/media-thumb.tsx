import { Clock, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";

/** 자동화 대상 게시물 썸네일. 썸네일이 없으면 범위별 아이콘 자리표시를 보여준다. */
export function MediaThumb({
  url,
  scope,
  className,
}: {
  url: string | null;
  scope: "specific" | "all" | "next";
  className?: string;
}) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={cn("shrink-0 rounded-[10px] object-cover", className)} />;
  }
  const Icon = scope === "next" ? Clock : scope === "all" ? LayoutGrid : null;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[10px]",
        scope === "next" ? "bg-[#F3FBDF]" : scope === "all" ? "bg-[#E6EBF0]" : "bg-[#E6EBF0]",
        className,
      )}
    >
      {Icon && <Icon className="size-5 text-ink-2" aria-hidden />}
    </span>
  );
}
