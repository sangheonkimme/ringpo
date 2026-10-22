"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveFaqAction, pauseConversationAction } from "@/app/app/campaigns/[id]/faq/actions";
import type { FaqInput } from "@/lib/campaign-faq";
import type { campaignFaqOverview } from "@/server/campaigns/faq-service";
import { reportDate } from "@/lib/campaign-report";

type Rule = Omit<FaqInput, "campaignId" | "requestId" | "expectedVersion"> & { id: string; version: number };
export function FaqRuleEditor({ campaignId, rule }: { campaignId: string; rule?: Rule }) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [message, setMessage] = useState("");
  const keywords = (value: FormDataEntryValue | null) => String(value ?? "").split(/[,\n]/).map((v) => v.trim()).filter(Boolean);
  function submit(form: FormData) {
    startTransition(async () => {
      try {
        const result = await saveFaqAction({ campaignId, id: rule?.id, expectedVersion: rule?.version, requestId: crypto.randomUUID(), keywords: keywords(form.get("keywords")), excludedKeywords: keywords(form.get("excluded")), matchType: form.get("matchType"), answer: form.get("answer"), enabled: form.get("enabled") === "on", priority: Number(form.get("priority")) });
        setMessage(result.ok ? "FAQ를 저장했어요." : result.error); if (result.ok) router.refresh();
      } catch { setMessage("FAQ를 저장하지 못했어요. 잠시 후 다시 확인해주세요."); }
    });
  }
  return <form action={submit} aria-label={rule ? `FAQ 수정: ${rule.keywords.join(", ")}` : "새 FAQ"} className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-sm">
    <h2 className="font-bold">{rule ? rule.keywords.join(" · ") : "FAQ 추가"}</h2>
    <label>문의 키워드<input name="keywords" required defaultValue={rule?.keywords.join(", ") ?? ""} placeholder="배송, 출고" className="mt-1 w-full rounded-lg border p-2" /></label>
    <label>제외 키워드<input name="excluded" defaultValue={rule?.excludedKeywords.join(", ") ?? ""} placeholder="배송 취소" className="mt-1 w-full rounded-lg border p-2" /></label>
    <p className="text-xs text-muted-foreground">키워드는 쉼표로 구분해요. 제외 키워드가 들어간 문의에는 이 답변을 보내지 않아요.</p>
    <div className="grid grid-cols-2 gap-3"><label>매칭 방식<select name="matchType" defaultValue={rule?.matchType ?? "contains"} className="mt-1 w-full rounded-lg border p-2"><option value="contains">포함</option><option value="exact">정확히 일치</option></select></label><label>우선순위<input type="number" min="0" max="100" name="priority" defaultValue={rule?.priority ?? 0} className="mt-1 w-full rounded-lg border p-2" /></label></div>
    <p className="text-xs text-muted-foreground">여러 답변이 맞으면 숫자가 작은 답변 하나만 보내요.</p>
    <label>자동 답변<textarea name="answer" required rows={4} defaultValue={rule?.answer ?? ""} placeholder="주문 다음 날부터 순차 출고됩니다." className="mt-1 w-full rounded-lg border p-2" /></label>
    <p className="text-xs text-muted-foreground">앞에 ‘공구 자동 안내’가 붙어요. 표시를 포함해 1,000바이트 이내로 작성해주세요.</p>
    <label className="flex items-center gap-2"><input name="enabled" type="checkbox" defaultChecked={rule?.enabled ?? true} />이 답변 사용</label>
    <button disabled={pending} className="rounded-lg bg-foreground px-4 py-3 font-semibold text-background disabled:opacity-50">{rule ? "FAQ 수정 저장" : "FAQ 추가 저장"}</button>
    {message && <p role="status">{message}</p>}
  </form>;
}
export function FaqConversations({ campaignId, items }: { campaignId: string; items: Awaited<ReturnType<typeof campaignFaqOverview>>["conversations"] }) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [message, setMessage] = useState("");
  function change(participantId: string, paused: boolean) {
    startTransition(async () => {
      try { const result = await pauseConversationAction({ campaignId, participantId, paused, requestId: crypto.randomUUID() }); setMessage(result.ok ? paused ? "대화 자동 응답을 일시정지했어요." : "새 문의의 자동 응답을 재개했어요." : result.error); if (result.ok) router.refresh(); }
      catch { setMessage("대화 설정을 변경하지 못했어요."); }
    });
  }
  return <section aria-label="대화 자동 응답" className="flex flex-col gap-3"><h2 className="text-lg font-bold">대화 자동 응답</h2><p className="text-sm text-muted-foreground">직접 답변한 문의는 다시 자동 응답하지 않아요. 일시정지는 같은 인스타 계정의 대화에 적용돼요.</p>
    {items.length ? <ul className="flex flex-col gap-3">{items.map((c) => <li className="rounded-xl border bg-card p-4 text-sm" key={c.participantId}><p className="font-semibold">{c.username ? `@${c.username}` : `DM 문의 · ${c.participantId.slice(0, 6)}`}</p>{c.preview && <p className="mt-2 break-words">{c.preview}</p>}<p className="mt-2 text-muted-foreground">최근 문의 {c.lastInteraction ? reportDate(c.lastInteraction) : "—"}</p>{c.pendingEcho && <p className="mt-2">보낸 답변을 확인하는 동안 자동 응답을 보류하고 있어요.</p>}{c.pausedUntil && <p className="mt-2">일시정지 종료 {reportDate(c.pausedUntil)}</p>}<div className="mt-3 flex gap-2"><button disabled={pending} className="rounded-lg border px-3 py-2" onClick={() => change(c.participantId, true)}>대화 일시정지</button><button disabled={pending || c.pendingEcho} className="rounded-lg border px-3 py-2 disabled:opacity-50" onClick={() => change(c.participantId, false)}>새 문의 재개</button></div></li>)}</ul> : <p className="text-sm text-muted-foreground">연결된 문의가 아직 없어요.</p>}{message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
