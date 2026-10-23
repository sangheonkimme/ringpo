import Link from "next/link";
import { notFound } from "next/navigation";
import { CAMPAIGN_STATE_LABELS } from "@/lib/campaign-schema";
import { campaignAccounts } from "@/server/campaigns/access";
import { listCampaigns } from "@/server/campaigns/service";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";

export const metadata = { title: "공구 캠페인" };

export default async function CampaignsPage() {
  const user = await requireUser(); const db = getDb();
  if ((await campaignAccounts(db, user.id)).length === 0) notFound();
  const campaigns = await listCampaigns(db, user.id);
  return <main className="flex flex-col gap-5 px-5 pb-28 pt-5">
    <div className="flex items-center justify-between"><h1 className="font-display text-[28px] leading-[1.3] tracking-[-0.02em]">공구 캠페인</h1><Link href="/app/campaigns/new" className="rounded-xl bg-foreground px-4 py-3 font-semibold text-background">새 공구</Link></div>
    <p className="text-sm text-muted-foreground">공구 일정과 게시물, 단계별 응답을 한곳에서 관리하세요.</p>
    {campaigns.length === 0 ? <p className="rounded-2xl border p-6 text-center">첫 공구를 등록해 주세요.</p> : <ul className="divide-y overflow-hidden rounded-2xl border bg-card">{campaigns.map((c) => <li key={c.id}><Link href={`/app/campaigns/${c.id}`} className="flex flex-col gap-2 p-4"><span className="font-bold">{c.title}</span><span className="text-sm text-muted-foreground">{c.status === "draft" && c.publishedAt ? "오픈 예약" : CAMPAIGN_STATE_LABELS[c.status]} · {c.brand || "브랜드 미입력"}</span></Link></li>)}</ul>}
  </main>;
}
