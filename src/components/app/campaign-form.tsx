"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveCampaignAction } from "@/app/app/campaigns/actions";
import { MediaPicker, type PickedMedia } from "./media-picker";
import { CampaignForecastPreview } from "./campaign-forecast-preview";
import { campaignEditedTime, campaignKstInput, DEFAULT_CAMPAIGN_TEMPLATES, type CampaignTemplates } from "@/lib/campaign-schema";

export interface CampaignDraft {
  igAccountId: string; title: string; brand: string; openAt: string; closeAt: string;
  notificationKeywords: string[]; linkKeywords: string[]; excludedKeywords: string[];
  matchType: "contains" | "exact"; followOnly: boolean; followFailurePolicy: "send_link" | "hold";
  expiryFallbackEnabled: boolean; hourlyRate: number; templates: CampaignTemplates;
  products: { id?: string; name: string; option: string; url: string }[];
  media: PickedMedia[];
}

const field = "w-full rounded-xl border border-input bg-card px-3 py-3 text-base";
const button = "rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50";
const stages = [{ key: "teaser", label: "예고" }, { key: "open", label: "진행" }, { key: "closed", label: "마감" }, { key: "sold_out", label: "품절" }] as const;

export function CampaignForm({ accounts, initial, id, version, features, defaultRate, nowIso }: {
  accounts: { id: string; username: string }[]; initial?: CampaignDraft; id?: string; version?: number;
  features: { followGate: boolean; scheduledDm: boolean }; defaultRate: number; nowIso: string;
}) {
  const router = useRouter(); const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CampaignDraft>(() => initial ?? {
    igAccountId: accounts[0]?.id ?? "", title: "", brand: "",
    openAt: new Date(new Date(nowIso).getTime() + 86_400_000).toISOString(),
    closeAt: new Date(new Date(nowIso).getTime() + 4 * 86_400_000).toISOString(),
    notificationKeywords: ["알림"], linkKeywords: ["링크"], excludedKeywords: [], matchType: "contains",
    followOnly: false, followFailurePolicy: "send_link", expiryFallbackEnabled: false, hourlyRate: defaultRate,
    templates: structuredClone(DEFAULT_CAMPAIGN_TEMPLATES), products: [{ name: "", option: "", url: "" }], media: [],
  });
  const [openAt, setOpenAt] = useState(() => campaignKstInput(new Date(draft.openAt)));
  const [closeAt, setCloseAt] = useState(() => campaignKstInput(new Date(draft.closeAt)));
  const [keywords, setKeywords] = useState(() => ({ notificationKeywords: draft.notificationKeywords.join(", "), linkKeywords: draft.linkKeywords.join(", "), excludedKeywords: draft.excludedKeywords.join(", ") }));
  const [stage, setStage] = useState<(typeof stages)[number]["key"]>("open");
  function patch<T extends keyof CampaignDraft>(key: T, value: CampaignDraft[T]) { setDraft((d) => ({ ...d, [key]: value })); }
  function changeTemplate(key: "privateReply" | "publicReplies", value: string | string[]) {
    setDraft((d) => ({ ...d, templates: { ...d.templates, [stage]: { ...d.templates[stage], [key]: value } } }));
  }
  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const input = {
          ...draft, openAt: campaignEditedTime(openAt, initial?.openAt), closeAt: campaignEditedTime(closeAt, initial?.closeAt), mediaIds: draft.media.map((m) => m.id),
          templates: { ...draft.templates, ...Object.fromEntries(stages.map(({ key }) => [key, { ...draft.templates[key], publicReplies: draft.templates[key].publicReplies.map((s) => s.trim()).filter(Boolean) }])) },
          ...Object.fromEntries(Object.entries(keywords).map(([key, value]) => [key, value.split(",").map((s) => s.trim()).filter(Boolean)])),
        };
        const result = await saveCampaignAction(input, { id, expectedVersion: version });
        if (!result.ok) { setError(result.error); return; }
        router.push(`/app/campaigns/${result.id}`); router.refresh();
      } catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했어요"); }
    });
  }
  return <form action={save} className="flex flex-col gap-6">
    <fieldset disabled={pending} className="flex flex-col gap-4 disabled:opacity-60">
      <legend className="mb-3 text-lg font-bold">공구 정보</legend>
      <label>인스타 계정<select className={field} value={draft.igAccountId} disabled={Boolean(id)} onChange={(e) => setDraft((d) => ({ ...d, igAccountId: e.target.value, media: [] }))}>{accounts.map((a) => <option key={a.id} value={a.id}>@{a.username}</option>)}</select></label>
      <label>공구 제목<input required maxLength={100} className={field} value={draft.title} onChange={(e) => patch("title", e.target.value)} /></label>
      <label>브랜드<input maxLength={100} className={field} value={draft.brand} onChange={(e) => patch("brand", e.target.value)} /></label>
      <label>오픈 시각 (한국 시간)<input type="datetime-local" required className={field} value={openAt} onChange={(e) => setOpenAt(e.target.value)} /></label>
      <label>마감 시각 (한국 시간)<input type="datetime-local" required className={field} value={closeAt} onChange={(e) => setCloseAt(e.target.value)} /></label>
    </fieldset>
    <fieldset disabled={pending} className="flex flex-col gap-3">
      <legend className="mb-3 text-lg font-bold">상품과 옵션</legend>
      <p className="text-sm text-muted-foreground">상품이 여러 개면 구매 링크에서 상품·옵션을 선택할 수 있어요. 구매 주소에는 Instagram DM 유입을 구분하는 UTM이 붙으며, 같은 이름의 기존 UTM은 대체돼요.</p>
      {draft.products.map((product, index) => <div key={product.id ?? index} className="flex flex-col gap-2 rounded-xl border p-3">
        {(["name", "option", "url"] as const).map((key) => <label key={key}>{({ name: "상품명", option: "옵션", url: "원본 구매 링크" })[key]}<input type={key === "url" ? "url" : "text"} required={key !== "option"} className={field} value={product[key]} onChange={(e) => patch("products", draft.products.map((p, i) => i === index ? { ...p, [key]: e.target.value } : p))} /></label>)}
        {draft.products.length > 1 && <button type="button" className={button} onClick={() => patch("products", draft.products.filter((_, i) => i !== index))}>상품 삭제</button>}
      </div>)}
      <button type="button" className={button} disabled={draft.products.length >= 20} onClick={() => patch("products", [...draft.products, { name: "", option: "", url: "" }])}>상품·옵션 추가</button>
    </fieldset>
    <fieldset disabled={pending} className="flex flex-col gap-3">
      <legend className="mb-3 text-lg font-bold">공구 게시물·릴스</legend>
      <p className="text-sm text-muted-foreground">게시물을 누르면 연결 목록에 추가돼요.</p>
      {draft.media.map((m) => <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg border p-2"><span className="truncate text-sm">{m.caption ?? m.id}</span><button type="button" className={button} aria-label={`${m.caption ?? m.id} 연결 해제`} onClick={() => patch("media", draft.media.filter((v) => v.id !== m.id))}>해제</button></div>)}
      <MediaPicker key={draft.igAccountId} accountId={draft.igAccountId} value={draft.media.at(-1) ?? null} onChange={(m) => { if (!draft.media.some((v) => v.id === m.id) && draft.media.length < 20) patch("media", [...draft.media, m]); }} />
    </fieldset>
    <fieldset disabled={pending} className="flex flex-col gap-3">
      <legend className="mb-3 text-lg font-bold">댓글 키워드</legend>
      <p className="text-sm text-muted-foreground">여러 단어는 쉼표로 구분해 주세요. 제외어가 있으면 자동으로 응답하지 않아요.</p>
      {(["linkKeywords", "notificationKeywords", "excludedKeywords"] as const).map((key) => <label key={key}>{({ linkKeywords: "구매 링크 키워드", notificationKeywords: "알림 신청 키워드", excludedKeywords: "제외어" })[key]}<input className={field} value={keywords[key]} onChange={(e) => setKeywords((k) => ({ ...k, [key]: e.target.value }))} /></label>)}
      <label>매칭 방식<select className={field} value={draft.matchType} onChange={(e) => patch("matchType", e.target.value as "contains" | "exact")}><option value="contains">포함 — 링크요, 링크 주세요도 응답</option><option value="exact">정확히 일치 — 문장부호·이모지는 제외</option></select></label>
    </fieldset>
    <fieldset disabled={pending} className="flex flex-col gap-3">
      <legend className="mb-3 text-lg font-bold">단계별 메시지</legend>
      <button type="button" className={button} onClick={() => patch("templates", structuredClone(DEFAULT_CAMPAIGN_TEMPLATES))}>기본 공구 템플릿 불러오기</button>
      <label>공구 단계<select className={field} value={stage} onChange={(e) => setStage(e.target.value as typeof stage)}>{stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
      <label>공개 답글 (줄마다 다른 문구, 비우면 보내지 않음)<textarea className={field} rows={3} value={draft.templates[stage].publicReplies.join("\n")} onChange={(e) => changeTemplate("publicReplies", e.target.value.split("\n"))} /></label>
      <label>DM 내용<textarea className={field} rows={4} value={draft.templates[stage].privateReply} onChange={(e) => changeTemplate("privateReply", e.target.value)} /></label>
      <p className="text-sm text-muted-foreground">{`{상품명}, {링크}, {오픈일시}, {게시물링크}가 자동으로 바뀌어요. 수정한 내용은 아직 보내지 않은 메시지에 적용돼요.`}</p>
      <p className="text-sm text-muted-foreground">구매 링크는 DM 버튼으로 표시돼요. 메시지가 길면 끝부분을 줄여 보내며, 구매 링크와 만료 안내의 오픈 일정·게시물 주소는 유지해요.</p>
    </fieldset>
    <fieldset disabled={pending} className="flex flex-col gap-3">
      <legend className="mb-3 text-lg font-bold">발송 설정</legend>
      <label>시간당 최대 발송 수<input type="number" min={1} max={750} required className={field} value={draft.hourlyRate} onChange={(e) => patch("hourlyRate", Number(e.target.value))} /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={draft.followOnly} disabled={!features.followGate} onChange={(e) => patch("followOnly", e.target.checked)} />팔로워 확인 후 링크 발송{!features.followGate && " (Pro)"}</label>
      {draft.followOnly && <><label>팔로우 안내<textarea rows={3} className={field} value={draft.templates.follow} onChange={(e) => patch("templates", { ...draft.templates, follow: e.target.value })} /></label><label>팔로우 조회가 일시 실패하면<select className={field} value={draft.followFailurePolicy} onChange={(e) => patch("followFailurePolicy", e.target.value as "send_link" | "hold")}><option value="send_link">링크 발송</option><option value="hold">발송 보류</option></select></label></>}
      <label className="flex items-center gap-2"><input type="checkbox" checked={draft.expiryFallbackEnabled} disabled={!features.scheduledDm} onChange={(e) => patch("expiryFallbackEnabled", e.target.checked)} />오픈 전에 만료될 신청에 일정 안내 발송{!features.scheduledDm && " (Pro)"}</label>
      {draft.expiryFallbackEnabled && <><label>만료 대체 안내<textarea rows={3} className={field} value={draft.templates.expiry} onChange={(e) => patch("templates", { ...draft.templates, expiry: e.target.value })} /></label><p className="text-sm text-muted-foreground">대체 안내를 받은 사람에게 같은 댓글로 오픈 DM을 다시 보내지 않아요.</p></>}
      <CampaignForecastPreview accountId={draft.igAccountId} campaignId={id} openAt={openAt} closeAt={closeAt} originalOpenAt={initial?.openAt} originalCloseAt={initial?.closeAt} hourlyRate={draft.hourlyRate} expiryFallback={draft.expiryFallbackEnabled} />
    </fieldset>
    {error && <p role="alert" className="rounded-xl bg-danger-soft p-3 text-danger-ink">{error}</p>}
    <button type="submit" disabled={pending} className="h-12 rounded-2xl bg-primary font-bold text-primary-foreground shadow-[0_4px_0_var(--foreground)] transition-transform active:translate-y-0.5 disabled:opacity-50">{pending ? "저장 중…" : id ? "변경 저장" : "초안 저장"}</button>
  </form>;
}
