import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { campaignCatalog } from "@/server/campaigns/links";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "공구 상품 선택", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function CampaignCatalogPage({ params }: { params: Promise<{ code: string }> }) {
  const catalog = await campaignCatalog(getDb(), (await params).code);
  if (!catalog) notFound();
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-12">
      {catalog.brand && <p className="mb-2 text-sm text-muted-foreground">{catalog.brand}</p>}
      <h1 className="break-words text-2xl font-semibold">{catalog.title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">구매할 상품과 옵션을 선택해 주세요.</p>
      <ul className="my-8 space-y-3">
        {catalog.products.map((product) => (
          <li key={product.code}>
            {/* Plain anchors prevent prefetch from registering a purchase-link click. */}
            <a href={`/r/${product.code}`} rel="nofollow noreferrer" className="block rounded-xl border bg-card p-5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
              <span className="block break-words font-medium">{product.name}</span>
              {product.option && <span className="mt-1 block break-words text-sm text-muted-foreground">{product.option}</span>}
              <span className="mt-3 block text-sm text-primary">상품 보러 가기 →</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">링포 · 공동구매 링크</p>
    </main>
  );
}
