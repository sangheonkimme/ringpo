import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { site } from "@/lib/site";
import { getDb } from "@/server/db/client";
import { dataDeletionRequests } from "@/server/db/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "데이터 삭제 요청" };

export default async function DataDeletionStatusPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(code)) notFound();
  const [req] = await getDb().select().from(dataDeletionRequests).where(eq(dataDeletionRequests.confirmationCode, code));
  if (!req) notFound();
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-xl font-bold">데이터 삭제 요청</h1>
      <p className="mt-4 text-sm text-muted-foreground">확인 코드: {req.confirmationCode}</p>
      <p className="mt-2 text-sm">
        상태: {req.status === "completed" ? "삭제 완료" : "처리 중"}
        {req.completedAt && ` (${req.completedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })})`}
      </p>
      <p className="mt-6 text-xs text-muted-foreground">
        {site.name}에 저장된 해당 인스타그램 계정의 연동 정보, 자동화, 댓글 처리 기록을 삭제했어요. 문의: {site.supportEmail}
      </p>
    </main>
  );
}
