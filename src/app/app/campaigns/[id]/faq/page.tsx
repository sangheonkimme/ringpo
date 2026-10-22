import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { FaqConversations, FaqRuleEditor } from "@/components/app/campaign-faq-panel";
import { CampaignError, campaignEntitlements } from "@/server/campaigns/access";
import { campaignFaqOverview } from "@/server/campaigns/faq-service";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";

export const metadata = { title: "공구 FAQ" };
export default async function FaqPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ before?: string }> }) {
  const user = await requireUser(); const { id } = await params; const { before } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const [overview, entitlements] = await Promise.all([campaignFaqOverview(db, user.id, id, before), campaignEntitlements(db, user.id)]).catch((error) => { if (error instanceof CampaignError) notFound(); throw error; });
  const canEdit = entitlements.get("campaign.faq")?.booleanValue === true;
  return <main className="flex flex-col gap-5 px-5 pb-28 pt-5"><Link href={`/app/campaigns/${id}`} className="text-sm text-muted-foreground">← 공구 운영</Link><h1 className="text-2xl font-extrabold">공구 FAQ</h1><p className="text-sm text-muted-foreground">진행 중인 공구의 DM 문의에 답해요. 고객이 먼저 보낸 문의의 24시간 안에서만 응답하며, 셀러가 직접 답하면 해당 대화의 자동 응답을 잠시 멈춰요.</p>
    {!overview.ready && <p role="status" className="rounded-xl border bg-card p-4 text-sm">이 계정은 직접 답변 감지 검증을 기다리고 있어요. FAQ를 미리 작성할 수 있고 검증 전에는 자동 발송하지 않아요.</p>}
    {canEdit ? <>{overview.rules.map((rule) => <FaqRuleEditor key={`${rule.id}:${rule.version}`} campaignId={id} rule={{ id: rule.id, version: rule.version, keywords: rule.keywords, excludedKeywords: rule.excludedKeywords, matchType: rule.matchType, answer: rule.answer, enabled: rule.enabled, priority: rule.priority }} />)}<FaqRuleEditor key={`new:${overview.rules.length}`} campaignId={id} /></> : <p className="rounded-xl border p-4 text-sm">FAQ 자동 응답은 공구 Pro 기능이에요.</p>}
    <FaqConversations campaignId={id} items={overview.conversations} />{overview.nextCursor && <Link href={`/app/campaigns/${id}/faq?before=${overview.nextCursor}`} className="rounded-xl border p-3 text-center">이전 대화 보기</Link>}
  </main>;
}
