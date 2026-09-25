"use client";

import { Check, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface PickedMedia {
  id: string;
  thumbnailUrl: string | null;
  permalink: string | null;
  caption: string | null;
}

interface Item extends PickedMedia {
  mediaType: string | null;
  timestamp: string | null;
}

export function MediaPicker({
  accountId,
  value,
  onChange,
}: {
  accountId: string;
  value: PickedMedia | null;
  onChange: (m: PickedMedia) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (after?: string) => {
      const qs = new URLSearchParams({ accountId, ...(after ? { after } : {}) });
      const res = await fetch(`/api/instagram/media?${qs}`);
      const body = (await res.json()) as { items?: Item[]; nextCursor?: string | null; error?: string };
      if (!res.ok) throw new Error(body.error ?? "게시물을 불러오지 못했어요");
      return { items: body.items ?? [], nextCursor: body.nextCursor ?? null };
    },
    [accountId],
  );

  useEffect(() => {
    let cancelled = false;
    fetchPage()
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "게시물을 불러오지 못했어요");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  async function loadMore(after: string) {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage(after);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "게시물을 불러오지 못했어요");
    } finally {
      setLoading(false);
    }
  }

  const selectedMissing = value && !items.some((m) => m.id === value.id);

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger-ink">{error}</p>}
      <div className="grid grid-cols-3 gap-1.5">
        {selectedMissing && value && <Tile media={value} selected onClick={() => onChange(value)} />}
        {items.map((m) => (
          <Tile key={m.id} media={m} selected={value?.id === m.id} reel={m.mediaType === "VIDEO"} onClick={() => onChange(m)} />
        ))}
      </div>
      {loading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" aria-label="불러오는 중" />}
      {!loading && cursor && (
        <button type="button" onClick={() => loadMore(cursor)} className="h-12 rounded-xl border border-input bg-card text-[15px] font-semibold">
          더 보기
        </button>
      )}
      {!loading && !error && items.length === 0 && <p className="text-center text-sm text-muted-foreground">게시물이 없어요</p>}
    </div>
  );
}

function Tile({ media, selected, reel, onClick }: { media: PickedMedia; selected: boolean; reel?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`게시물: ${media.caption ?? "캡션 없음"}${selected ? " (선택됨)" : ""}`}
      className={cn(
        "relative flex aspect-square items-end overflow-hidden rounded-[10px] bg-[#E6EBF0] p-1.5",
        selected && "shadow-[inset_0_0_0_3px_var(--foreground)]",
      )}
    >
      {media.thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.thumbnailUrl} alt="" className={cn("absolute inset-0 size-full object-cover", selected && "p-[3px] rounded-[10px]")} loading="lazy" />
      )}
      {reel && <span className="relative rounded bg-white/90 px-1.5 py-px text-[11px] font-bold">릴스</span>}
      {selected && (
        <span className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-foreground">
          <Check className="size-3.5 text-white" strokeWidth={3} aria-hidden />
        </span>
      )}
    </button>
  );
}
