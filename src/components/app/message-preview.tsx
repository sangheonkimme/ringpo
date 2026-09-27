/** 인스타 앱의 버튼 템플릿처럼 말풍선 안에 폭 전체 버튼이 들어간 DM. 버튼은 미리보기용이라 누를 수 없다 */
export function DmBubble({ text, buttonTitle, branding = null }: { text: string; buttonTitle: string; branding?: string | null }) {
  return (
    <div className="flex max-w-[88%] flex-col gap-3 rounded-[20px] bg-bubble p-4">
      {/* 무료 플랜 표시는 실제 발송처럼 본문 끝에 한 줄 띄고 붙는다(dm-content.ts) */}
      <p className="whitespace-pre-line text-[15px] leading-[1.6]">{branding ? `${text}\n\n${branding}` : text}</p>
      <span className="flex h-11 w-full items-center justify-center rounded-xl bg-card text-[15px] font-semibold text-foreground">{buttonTitle}</span>
    </div>
  );
}

export function MessagePreview({
  keyword,
  reply,
  dmText,
  buttonTitle,
  branding,
  username,
  gate = null,
}: {
  keyword: string;
  reply: string | null;
  dmText: string;
  buttonTitle: string;
  branding: string | null;
  username: string;
  /** 팔로우 확인을 켰으면 먼저 보낼 안내 */
  gate?: string | null;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex flex-col gap-3 border-b border-line-soft p-4">
        <span className="text-xs font-semibold text-muted-foreground">1. 댓글이 달리면</span>
        <div className="flex items-start gap-2">
          <span className="size-7 shrink-0 rounded-full bg-input" />
          <p className="text-sm leading-normal">
            <strong>jiwoo.daily</strong>{" "}
            <mark className="bg-transparent bg-[linear-gradient(transparent_55%,var(--color-brand)_55%)] text-inherit">{keyword || "댓글"}</mark>
          </p>
        </div>
        {reply && (
          <div className="flex items-start gap-2 pl-9">
            <span className="size-6 shrink-0 rounded-full bg-foreground" />
            <p className="text-sm leading-normal">
              <strong>{username}</strong> {reply.replaceAll("{username}", "@jiwoo.daily")}
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2.5 bg-background p-4">
        <span className="text-xs font-semibold text-muted-foreground">2. 댓글 단 사람에게 DM</span>
        {gate && (
          <>
            <DmBubble text={gate} buttonTitle="팔로우했어요" />
            <span className="text-xs font-semibold text-muted-foreground">3. 버튼을 누르고 팔로우가 확인되면</span>
          </>
        )}
        <DmBubble text={dmText || "DM 내용"} buttonTitle={buttonTitle || "버튼"} branding={branding} />
      </div>
    </section>
  );
}
