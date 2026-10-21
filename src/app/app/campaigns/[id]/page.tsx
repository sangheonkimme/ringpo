import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CampaignControls } from "@/components/app/campaign-controls";
import { CAMPAIGN_STATE_LABELS } from "@/lib/campaign-schema";
import { campaignEntitlements } from "@/server/campaigns/access";
import { getCampaign } from "@/server/campaigns/service";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";

export const metadata = { title: "공구 상세" };
const date = (value: Date) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(value);

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(); const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb(); const campaign = await getCampaign(db, user.id, id);
  if (!campaign) notFound();
  const entitlements = await campaignEntitlements(db, user.id);
  return <main className="flex flex-col gap-5 px-5 pb-28 pt-5">
    <Link href="/app/campaigns" className="text-sm text-muted-foreground">← 공구 목록</Link>
    <div className="flex items-start justify-between gap-3"><h1 className="text-2xl font-extrabold">{campaign.title}</h1>{campaign.status !== "settled" && <Link href={`/app/campaigns/${id}/edit`} className="shrink-0 rounded-xl border px-4 py-2 text-sm">수정</Link>}</div>
    <p className="font-semibold">{campaign.status === "draft" && campaign.publishedAt ? "오픈 예약" : CAMPAIGN_STATE_LABELS[campaign.status]}</p>
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border bg-card p-4 text-sm"><dt>브랜드</dt><dd>{campaign.brand || "—"}</dd><dt>오픈</dt><dd>{date(campaign.openAt)}</dd><dt>마감</dt><dd>{date(campaign.closeAt)}</dd><dt>발송 속도</dt><dd>최대 {campaign.hourlyRate}건/시간</dd><dt>연결 게시물</dt><dd>{campaign.media.length}개</dd></dl>
    <CampaignControls id={id} version={campaign.version} status={campaign.status} published={Boolean(campaign.publishedAt)} scheduledDm={entitlements.get("campaign.scheduled_dm")?.booleanValue === true} />
    <section className="flex flex-col gap-3"><h2 className="text-lg font-bold">상품</h2><ul className="divide-y rounded-xl border bg-card">{campaign.products.map((p) => <li key={p.id} className="p-3"><span className="font-semibold">{p.name}</span>{p.option && <span className="ml-2 text-sm text-muted-foreground">{p.option}</span>}</li>)}</ul></section>
    <section className="flex flex-col gap-3"><h2 className="text-lg font-bold">운영 이력</h2><ul className="flex flex-col gap-2 text-sm">{campaign.audit.map((a) => <li key={a.id} className="rounded-xl border p-3">{a.reason} · {date(a.createdAt)}{a.toState && <span className="ml-2">→ {CAMPAIGN_STATE_LABELS[a.toState as keyof typeof CAMPAIGN_STATE_LABELS] ?? a.toState}</span>}</li>)}</ul></section>
  </main>;
}
