import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportShareList } from "@/components/app/report-share-list";
import { CampaignError } from "@/server/campaigns/access";
import { listReportShares } from "@/server/campaigns/report-shares";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";

export const metadata = { title: "공유 리포트 관리" };
export default async function ReportSharesPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const user = await requireUser(); const { before } = await searchParams;
  const list = await listReportShares(getDb(), user.id, undefined, before).catch((error) => { if (error instanceof CampaignError && error.code === "validation") notFound(); throw error; });
  return <main className="flex flex-col gap-5 px-5 pb-28 pt-5"><Link href="/app/settings" className="text-sm text-muted-foreground">← 설정</Link><h1 className="font-display text-[28px] leading-[1.3] tracking-[-0.02em]">공유 리포트 관리</h1><p className="text-sm text-muted-foreground">공구 기능이 꺼져 있거나 요금제가 바뀌어도 기존 공유 링크를 폐기할 수 있어요. 이미 내려받은 PDF는 회수되지 않아요.</p><ReportShareList items={list.items} />{list.nextCursor && <Link className="rounded-xl border p-3 text-center" href={`/app/report-shares?before=${list.nextCursor}`}>이전 공유 링크 보기</Link>}</main>;
}
