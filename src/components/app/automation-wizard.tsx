"use client";

import { Check, ChevronLeft, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveAutomationAction } from "@/app/app/automations/actions";
import { MediaPicker, type PickedMedia } from "@/components/app/media-picker";
import { MessagePreview } from "@/components/app/message-preview";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ToggleSwitch } from "@/components/app/toggle-switch";
import {
  BUTTON_TITLE_MAX,
  DEFAULT_BUTTON_TITLE,
  DEFAULT_DM_TEXT,
  DEFAULT_FOLLOW_GATE_TEXT,
  DEFAULT_REPLY_TEXTS,
  FOLLOW_GATE_TEXT_MAX,
  DM_TEXT_MAX,
  REPLY_MAX,
  type AutomationInput,
} from "@/lib/automation-schema";
import { draftKey, parseStoredDraft, serializeDraft } from "@/lib/draft-storage";
import { keywordSummary, TOGGLE_ERROR } from "@/lib/event-labels";
import { cn } from "@/lib/utils";

export interface WizardAccount {
  id: string;
  username: string;
}

export type Draft = Omit<AutomationInput, "media"> & { media: PickedMedia | null };

const STEPS = ["게시물", "반응할 댓글", "공개 답글", "DM", "확인"] as const;
const SCOPE_LABEL = { specific: "특정 게시물", all: "모든 게시물", next: "다음에 올릴 게시물" } as const;
const SAVE_FAILED = "저장하지 못했어요. 앱이 새로 배포됐을 수 있어요. 새로고침해도 입력한 내용은 그대로 남아요.";

const input =
  "h-[50px] w-full rounded-xl border border-input bg-card px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring";

function OptionCard({
  selected,
  title,
  description,
  onClick,
  children,
}: {
  selected: boolean;
  title: string;
  description: string;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3.5 rounded-[14px] border-2 bg-card p-4 text-left",
        selected ? "border-foreground" : "border-border",
      )}
    >
      {selected ? (
        <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-foreground">
          <Check className="size-3.5 text-white" strokeWidth={3} aria-hidden />
        </span>
      ) : (
        <span className="size-[22px] shrink-0 rounded-full border-2 border-[#D3DBE5]" />
      )}
      <span className="flex flex-col gap-1.5">
        <span className="text-base font-bold">{title}</span>
        <span className="text-[13px] leading-relaxed text-muted-foreground">{description}</span>
        {children}
      </span>
    </button>
  );
}

export function AutomationWizard({
  accounts,
  initial,
  automationId,
  branding,
  linkTracking,
}: {
  accounts: WizardAccount[];
  initial?: Draft;
  automationId?: string;
  branding: string | null;
  linkTracking: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [keywordInput, setKeywordInput] = useState("");
  const lastReplyIndex = useRef(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const [draft, setDraft] = useState<Draft>(
    initial ?? {
      igAccountId: accounts[0]?.id ?? "",
      name: "",
      mediaScope: "specific",
      media: null,
      keywords: [],
      matchType: "contains",
      replyEnabled: true,
      replyTexts: DEFAULT_REPLY_TEXTS,
      dmText: DEFAULT_DM_TEXT,
      dmButtonTitle: DEFAULT_BUTTON_TITLE,
      dmLinkUrl: "https://",
      followGate: false,
      followGateText: DEFAULT_FOLLOW_GATE_TEXT,
    },
  );
  const [startDraft] = useState(() => JSON.stringify(draft));
  const saved = useRef(false);
  const restored = useRef(false);
  const storageKey = draftKey(automationId);
  const dirty = JSON.stringify(draft) !== startDraft || keywordInput.trim() !== "";
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const closeHref = automationId ? `/app/automations/${automationId}` : "/app/automations";
  const account = accounts.find((a) => a.id === draft.igAccountId);
  const cleanReplies = draft.replyTexts.map((t) => t.trim()).filter(Boolean);

  function stepError(i: number): string | null {
    if (i === 0) {
      if (!draft.igAccountId) return "인스타 계정을 선택해주세요";
      if (draft.mediaScope === "specific" && !draft.media) return "게시물을 선택해주세요";
    }
    if (i === 1 && draft.matchType !== "any" && draft.keywords.length === 0) return "키워드를 1개 이상 입력해주세요";
    if (i === 2 && draft.replyEnabled && cleanReplies.length === 0) return "답글 문구를 1개 이상 입력해주세요";
    if (i === 3) {
      if (!draft.dmText.trim()) return "DM 내용을 입력해주세요";
      if (!draft.dmButtonTitle.trim()) return "버튼 문구를 입력해주세요";
      if (!/^https:\/\/\S+\.\S+/.test(draft.dmLinkUrl)) return "https:// 로 시작하는 링크를 입력해주세요";
    }
    if (i === 4 && !draft.name.trim()) return "자동화 이름을 입력해주세요";
    return null;
  }

  function forgetDraft() {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // 저장소를 못 쓰는 환경이면 보관도 안 된 상태다
    }
  }

  // 새로고침·배포·탭 닫기 뒤에 다시 열면 보관해 둔 초안을 되살린다. 서버 렌더와 어긋나지 않게 화면이 뜬 뒤에 읽는다
  useEffect(() => {
    let stored: { draft: Draft; step: number } | null = null;
    try {
      stored = parseStoredDraft<Draft>(localStorage.getItem(storageKey), new Date());
    } catch {
      stored = null;
    }
    restored.current = true;
    if (!stored) return;
    const { draft: kept, step: keptStep } = stored;
    // 예전에 보관한 초안에 없는 항목(예: 팔로우 확인)은 기본값으로 채운다
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 저장소는 마운트 뒤에만 읽을 수 있다
    setDraft({ ...(JSON.parse(startDraft) as Draft), ...kept });
    setStep(Math.min(Math.max(keptStep, 0), STEPS.length - 1));
    toast.info("작성 중이던 내용을 불러왔어요", {
      action: {
        label: "새로 시작",
        onClick: () => {
          forgetDraft();
          setDraft(JSON.parse(startDraft) as Draft);
          setStep(0);
        },
      },
    });
    // 초안은 처음 한 번만 되살린다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // 입력할 때마다 초안을 보관한다(24시간). 저장에 성공하거나 '나가기'를 고르면 지운다
  useEffect(() => {
    if (!restored.current || saved.current) return;
    try {
      if (dirty) localStorage.setItem(storageKey, serializeDraft(draft, step, new Date()));
      else localStorage.removeItem(storageKey);
    } catch {
      // 저장소를 못 쓰면 보관 없이 계속한다
    }
  }, [draft, step, dirty, storageKey]);

  function close() {
    if (dirty) setConfirmClose(true);
    else router.push(closeHref);
  }

  function next() {
    const err = stepError(step);
    if (err) return void toast.error(err);
    if (step === 3 && !draft.name.trim()) {
      set("name", draft.matchType === "any" ? "모든 댓글 자동화" : `${draft.keywords[0] ?? "새"} 자동화`);
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0 });
  }

  function back() {
    setStep((s) => Math.max(s - 1, 0));
    window.scrollTo({ top: 0 });
  }

  function addKeyword() {
    const k = keywordInput.trim();
    if (!k) return;
    if (draft.keywords.length >= 10) return void toast.error("키워드는 10개까지 넣을 수 있어요");
    if (!draft.keywords.includes(k)) set("keywords", [...draft.keywords, k]);
    setKeywordInput("");
  }

  function insertUsername() {
    const i = Math.min(lastReplyIndex.current, draft.replyTexts.length - 1);
    if (i < 0) return set("replyTexts", ["{username} "]);
    set(
      "replyTexts",
      draft.replyTexts.map((t, j) => (j === i ? `${t.trimEnd()} {username}`.trim() : t)),
    );
  }

  function save(activate: boolean) {
    const err = stepError(4);
    if (err) return void toast.error(err);
    startTransition(async () => {
      const payload = { ...draft, replyTexts: cleanReplies, keywords: draft.matchType === "any" ? [] : draft.keywords };
      let res: Awaited<ReturnType<typeof saveAutomationAction>>;
      try {
        res = await saveAutomationAction(payload, { id: automationId, activate });
      } catch {
        // 배포로 서버 쪽 저장 함수가 바뀌었거나 네트워크가 끊긴 경우. 초안은 이미 보관돼 있다
        return void toast.error(SAVE_FAILED, { duration: 15_000, action: { label: "새로고침", onClick: () => window.location.reload() } });
      }
      if (!res.ok) return void toast.error(res.error);
      saved.current = true;
      forgetDraft();
      if (activate && !res.activated && res.activationError) toast.warning(`저장했지만 켜지 못했어요. ${TOGGLE_ERROR[res.activationError]}`);
      else toast.success(activate ? "자동화를 켰어요" : "저장했어요");
      router.push(`/app/automations/${res.id}`);
      router.refresh();
    });
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-background/95 pl-2 pr-3 backdrop-blur">
        {step === 0 ? (
          <button type="button" onClick={close} aria-label="뒤로" className="flex size-11 items-center justify-center">
            <ChevronLeft className="size-[22px]" aria-hidden />
          </button>
        ) : (
          <button type="button" onClick={back} aria-label="이전 단계" className="flex size-11 items-center justify-center">
            <ChevronLeft className="size-[22px]" aria-hidden />
          </button>
        )}
        <span className="text-base font-bold">{automationId ? "자동화 수정" : "새 자동화"}</span>
        <button type="button" onClick={close} className="flex h-11 items-center px-2 text-sm text-ink-2">
          닫기
        </button>
      </header>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>작성을 그만둘까요?</AlertDialogTitle>
            <AlertDialogDescription>지금 나가면 입력한 내용이 저장되지 않아요.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>계속 작성</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                forgetDraft();
                router.push(closeHref);
              }}
            >
              나가기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex flex-col gap-2 px-5 pt-4">
        <div className="flex justify-between text-[13px]">
          <span className="font-bold">
            {step + 1} / {STEPS.length} · {STEPS[step]}
          </span>
          <span className="text-muted-foreground">{step < STEPS.length - 1 ? `다음: ${STEPS[step + 1]}` : "마지막 단계"}</span>
        </div>
        <div role="img" aria-label={`${STEPS.length}단계 중 ${step + 1}단계`} className="grid grid-cols-5 gap-1">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={cn("h-1 rounded-full", i < step || (i === step && step < STEPS.length - 1) ? "bg-foreground" : i === step ? "bg-brand" : "bg-border")}
            />
          ))}
        </div>
      </div>

      <main className="flex flex-col gap-5 px-5 pb-32 pt-6">
        {step === 0 && (
          <>
            <h1 className="font-display text-2xl font-extrabold leading-[1.35] tracking-[-0.03em]">
              어떤 게시물의 댓글에
              <br />
              반응할까요?
            </h1>
            {accounts.length > 1 && (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold">인스타 계정</span>
                <div className="flex flex-wrap gap-2">
                  {accounts.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      aria-pressed={draft.igAccountId === a.id}
                      onClick={() => setDraft((d) => ({ ...d, igAccountId: a.id, media: null }))}
                      className={cn(
                        "h-11 rounded-full border-2 px-4 text-sm font-semibold",
                        draft.igAccountId === a.id ? "border-foreground bg-card" : "border-border bg-card text-ink-2",
                      )}
                    >
                      @{a.username}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2.5">
              <OptionCard
                selected={draft.mediaScope === "specific"}
                title="특정 게시물·릴스"
                description="고른 게시물 하나의 댓글에만 반응해요"
                onClick={() => set("mediaScope", "specific")}
              />
              <OptionCard
                selected={draft.mediaScope === "next"}
                title="다음에 올릴 게시물"
                description="지금 이후 처음 올리는 게시물에 자동 연결돼요"
                onClick={() => set("mediaScope", "next")}
              />
              <OptionCard
                selected={draft.mediaScope === "all"}
                title="모든 게시물"
                description="계정의 모든 게시물 댓글에 반응해요"
                onClick={() => set("mediaScope", "all")}
              />
            </div>
            {draft.mediaScope === "specific" && draft.igAccountId && (
              <div className="flex flex-col gap-3">
                <div className="mt-2 flex items-center justify-between">
                  <h2 className="text-[15px] font-bold">게시물 선택</h2>
                  <span className="text-[13px] text-muted-foreground">최근 게시물</span>
                </div>
                <MediaPicker key={draft.igAccountId} accountId={draft.igAccountId} value={draft.media} onChange={(m) => set("media", m)} />
              </div>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="font-display text-2xl font-extrabold leading-[1.35] tracking-[-0.03em]">
              어떤 댓글에
              <br />
              반응할까요?
            </h1>
            <div className="flex flex-col gap-2.5">
              <OptionCard
                selected={draft.matchType === "contains"}
                title="키워드가 들어간 댓글"
                description="문장 안에 키워드가 있으면 반응해요"
                onClick={() => set("matchType", "contains")}
              >
                <span className="flex flex-wrap gap-1.5">
                  {["“공구요!”", "“@친구 공구”", "“링크 주세요”"].map((ex) => (
                    <span key={ex} className="rounded-md bg-background px-2 py-0.5 text-xs text-ink-2">
                      {ex}
                    </span>
                  ))}
                </span>
              </OptionCard>
              <OptionCard
                selected={draft.matchType === "exact"}
                title="키워드만 있는 댓글"
                description="댓글이 키워드와 정확히 같을 때만 반응해요. 끝의 이모지·문장부호는 무시해요"
                onClick={() => set("matchType", "exact")}
              />
              <OptionCard
                selected={draft.matchType === "any"}
                title="모든 댓글"
                description="키워드 없이 댓글을 단 모든 사람에게 보내요. 같은 게시물에서는 한 사람에게 한 번만 가요"
                onClick={() => set("matchType", "any")}
              />
            </div>
            {draft.matchType !== "any" && (
              <div className="flex flex-col gap-2.5">
                <label htmlFor="kw" className="text-sm font-semibold">
                  반응할 키워드
                </label>
                <div className="flex gap-2">
                  <input
                    id="kw"
                    value={keywordInput}
                    placeholder="예: 공구, 링크"
                    maxLength={30}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        addKeyword();
                      }
                    }}
                    className={cn(input, "h-[52px] min-w-0 flex-1 text-base")}
                  />
                  <button type="button" onClick={addKeyword} className="h-[52px] rounded-xl border-[1.5px] border-foreground bg-card px-[18px] text-[15px] font-semibold">
                    추가
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {draft.keywords.map((k) => (
                    <span key={k} className="flex h-9 items-center gap-0.5 rounded-full bg-chip pl-3.5 pr-1.5 text-[15px] font-bold text-chip-foreground">
                      {k}
                      <button
                        type="button"
                        aria-label={`${k} 삭제`}
                        onClick={() => set("keywords", draft.keywords.filter((x) => x !== k))}
                        className="flex size-7 items-center justify-center rounded-full"
                      >
                        <X className="size-3.5" strokeWidth={2.6} aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <p className="rounded-xl bg-neutral-soft px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">
              영문 대소문자, 전각 문자(ＬＩＮＫ), 띄어쓰기 차이는 구분하지 않아요. ‘모든 댓글’을 고르면 키워드 입력은 필요 없어요.
            </p>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="font-display text-2xl font-extrabold leading-[1.35] tracking-[-0.03em]">
              댓글에 공개 답글도
              <br />
              달아둘까요?
            </h1>
            <div className="flex items-center justify-between gap-3 rounded-[14px] border bg-card py-3.5 pl-4 pr-2">
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] font-bold">공개 답글 달기</span>
                <span className="text-[13px] text-muted-foreground">다른 팔로워에게도 DM이 간다는 걸 보여줘요</span>
              </span>
              <ToggleSwitch checked={draft.replyEnabled} onChange={(v) => set("replyEnabled", v)} label="공개 답글 달기" />
            </div>
            {draft.replyEnabled && (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold">답글 문구</h2>
                  <span className="text-xs text-muted-foreground">
                    {cleanReplies.length > 1 ? `${cleanReplies.length}개 중 무작위로 보내요` : "문구 1개를 보내요"}
                  </span>
                </div>
                {draft.replyTexts.map((t, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <label htmlFor={`reply-${i}`} className="sr-only">
                      답글 문구 {i + 1}
                    </label>
                    <input
                      id={`reply-${i}`}
                      value={t}
                      maxLength={REPLY_MAX}
                      onFocus={() => (lastReplyIndex.current = i)}
                      onChange={(e) => set("replyTexts", draft.replyTexts.map((x, j) => (j === i ? e.target.value : x)))}
                      className={cn(input, "min-w-0 flex-1")}
                    />
                    <button
                      type="button"
                      aria-label={`문구 ${i + 1} 삭제`}
                      onClick={() => set("replyTexts", draft.replyTexts.filter((_, j) => j !== i))}
                      className="flex size-11 items-center justify-center text-muted-foreground"
                    >
                      <X className="size-[18px]" aria-hidden />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2">
                  {draft.replyTexts.length < 5 && (
                    <button
                      type="button"
                      onClick={() => set("replyTexts", [...draft.replyTexts, "{username} "])}
                      className="flex h-11 items-center gap-1.5 rounded-xl border border-dashed border-[#8793A3] px-3.5 text-sm font-semibold"
                    >
                      <Plus className="size-4" strokeWidth={2.4} aria-hidden />
                      문구 추가
                    </button>
                  )}
                  <button type="button" onClick={insertUsername} className="h-11 rounded-xl bg-neutral-soft px-3.5 text-sm font-semibold">
                    {"{username}"} 넣기
                  </button>
                </div>
                {cleanReplies.length < 3 && <p className="text-xs text-warning-ink">문구를 3개 이상 넣는 걸 권장해요.</p>}
              </div>
            )}
            <ul className="flex list-disc flex-col gap-1.5 rounded-xl bg-neutral-soft py-3.5 pl-8 pr-3.5 text-[13px] leading-relaxed text-ink-2">
              <li>{"{username}"}은 댓글 단 사람의 @아이디로 바뀌어요.</li>
              <li>같은 문구만 반복하면 스팸으로 보일 수 있어 3개 이상을 권장해요.</li>
              <li>공개 답글에는 링크를 넣을 수 없어요. 링크는 DM으로 보내요.</li>
            </ul>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="font-display text-2xl font-extrabold leading-[1.35] tracking-[-0.03em]">
              DM으로 무엇을
              <br />
              보낼까요?
            </h1>
            <div className="flex flex-col gap-2">
              <label htmlFor="dm" className="text-sm font-semibold">
                DM 내용
              </label>
              <textarea
                id="dm"
                rows={4}
                maxLength={DM_TEXT_MAX}
                value={draft.dmText}
                placeholder="예: 요청하신 공구 링크 보내드려요. 오늘 자정까지 특가예요."
                onChange={(e) => set("dmText", e.target.value)}
                className="resize-none rounded-xl border border-input bg-card px-4 py-3.5 text-base leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="self-end text-xs text-muted-foreground">
                {Array.from(draft.dmText).length} / {DM_TEXT_MAX}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="btn" className="text-sm font-semibold">
                버튼 문구
              </label>
              <input id="btn" maxLength={BUTTON_TITLE_MAX} value={draft.dmButtonTitle} onChange={(e) => set("dmButtonTitle", e.target.value)} className={input} />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="url" className="text-sm font-semibold">
                링크
              </label>
              <input id="url" type="url" inputMode="url" value={draft.dmLinkUrl} onChange={(e) => set("dmLinkUrl", e.target.value)} className={input} />
              <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
                {linkTracking ? (
                  <>
                    <Check className="size-[15px] text-success" strokeWidth={2.4} aria-hidden />
                    링크 클릭 수를 자동으로 세요
                  </>
                ) : (
                  "Free 플랜은 DM 하단에 서비스 표시가 붙고, 링크 클릭 추적은 Pro부터 돼요"
                )}
              </span>
            </div>
            <div className="flex flex-col gap-2.5 rounded-2xl border bg-card p-4">
              <span className="text-xs font-semibold text-muted-foreground">받는 사람 화면 미리보기</span>
              <p className="max-w-[88%] whitespace-pre-wrap rounded-[16px_16px_16px_6px] bg-bubble px-3.5 py-3 text-sm leading-relaxed">
                {draft.dmText || "DM 내용"}
                {branding && <span className="mt-2 block text-xs text-muted-foreground">{branding}</span>}
              </p>
              <span className="flex h-[42px] max-w-[88%] items-center justify-center rounded-[10px] border text-sm font-semibold">
                {draft.dmButtonTitle || "버튼"}
              </span>
            </div>
            <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[15px] font-bold">팔로워에게만 링크 보내기</span>
                  <span className="text-[13px] leading-relaxed text-muted-foreground">
                    켜면 먼저 ‘팔로우했어요’ 버튼이 달린 안내를 보내고, 버튼을 눌렀을 때 팔로우가 확인되면 링크를 보내요. 이미 팔로우한
                    사람도 버튼을 한 번 눌러야 해요.
                  </span>
                </div>
                <ToggleSwitch checked={draft.followGate} onChange={(v) => set("followGate", v)} label="팔로워에게만 링크 보내기" />
              </div>
              {draft.followGate && (
                <div className="flex flex-col gap-2">
                  <label htmlFor="gate" className="text-sm font-semibold">
                    먼저 보낼 안내
                  </label>
                  <textarea
                    id="gate"
                    rows={4}
                    maxLength={FOLLOW_GATE_TEXT_MAX}
                    value={draft.followGateText}
                    placeholder={DEFAULT_FOLLOW_GATE_TEXT}
                    onChange={(e) => set("followGateText", e.target.value)}
                    className="resize-none rounded-xl border border-input bg-card px-4 py-3.5 text-base leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    버튼 문구는 ‘팔로우했어요’로 고정이에요. 팔로우가 안 돼 있으면 “아직 팔로우가 확인되지 않았어요”라고 다시 안내해요.
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h1 className="font-display text-2xl font-extrabold leading-[1.35] tracking-[-0.03em]">이렇게 보내드릴게요</h1>
            <div className="flex flex-col gap-2">
              <label htmlFor="name" className="text-sm font-semibold">
                자동화 이름
              </label>
              <input id="name" maxLength={50} value={draft.name} onChange={(e) => set("name", e.target.value)} className={input} />
            </div>
            <MessagePreview
              keyword={draft.matchType === "any" ? "예뻐요!" : (draft.keywords[0] ?? "")}
              reply={draft.replyEnabled ? (cleanReplies[0] ?? null) : null}
              dmText={draft.dmText}
              buttonTitle={draft.dmButtonTitle}
              branding={branding}
              username={account?.username ?? "나"}
              gate={draft.followGate ? draft.followGateText.trim() || DEFAULT_FOLLOW_GATE_TEXT : null}
            />
            <dl className="flex flex-col gap-3 rounded-2xl border bg-card p-4 text-sm">
              {[
                ["대상", draft.mediaScope === "specific" && draft.media?.caption ? `${SCOPE_LABEL.specific} · ${draft.media.caption.slice(0, 20)}` : SCOPE_LABEL[draft.mediaScope]],
                ["반응", keywordSummary(draft.keywords, draft.matchType)],
                ["공개 답글", draft.replyEnabled ? `문구 ${cleanReplies.length}개${cleanReplies.length > 1 ? " 무작위" : ""}` : "보내지 않음"],
                ["링크", draft.dmLinkUrl.replace(/^https:\/\//, "")],
                ["팔로우 확인", draft.followGate ? "켬 · 팔로워에게만 링크" : "끔"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="shrink-0 text-muted-foreground">{k}</dt>
                  <dd className="truncate font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="rounded-xl bg-neutral-soft px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">
              인스타그램 규칙상 DM은 댓글 1개당 1번, 댓글 후 7일 안에만 보낼 수 있어요. 이 자동화는 게시물마다 한 사람에게 한
              번만 보내요.
            </p>
          </>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background">
        <div className="mx-auto flex max-w-lg gap-2 px-5 pb-[max(env(safe-area-inset-bottom),24px)] pt-3">
          {step === STEPS.length - 1 ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => save(false)}
                className="h-[54px] rounded-[14px] border-[1.5px] border-foreground px-5 text-base font-semibold disabled:opacity-60"
              >
                저장만
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => save(true)}
                className="flex h-[54px] flex-1 items-center justify-center gap-2 rounded-[14px] bg-foreground text-base font-semibold text-white disabled:opacity-60"
              >
                <span className="size-2 rounded-full bg-brand" />
                켜고 저장
              </button>
            </>
          ) : (
            <>
              {step > 0 && (
                <button type="button" onClick={back} className="h-[54px] rounded-[14px] border-[1.5px] border-foreground px-[22px] text-base font-semibold">
                  이전
                </button>
              )}
              <button type="button" onClick={next} className="h-[54px] flex-1 rounded-[14px] bg-foreground text-base font-semibold text-white">
                다음
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
