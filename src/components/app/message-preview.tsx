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
    <section className="overflow-hidden rounded-[18px] border bg-card">
      <div className="flex flex-col gap-3 border-b border-line-soft p-4">
        <span className="text-xs font-semibold text-muted-foreground">1. 댓글이 달리면</span>
        <div className="flex items-start gap-2">
          <span className="size-7 shrink-0 rounded-full bg-[#D3DBE5]" />
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
      <div className="flex flex-col gap-2.5 bg-[#F6F8FA] p-4">
        <span className="text-xs font-semibold text-muted-foreground">2. 댓글 단 사람에게 DM</span>
        {gate && (
          <>
            <p className="max-w-[88%] whitespace-pre-wrap rounded-[16px_16px_16px_6px] bg-bubble px-3.5 py-3 text-sm leading-relaxed">{gate}</p>
            <span className="flex h-[42px] max-w-[88%] items-center justify-center rounded-[10px] border bg-card text-sm font-semibold">팔로우했어요</span>
            <span className="text-xs font-semibold text-muted-foreground">3. 버튼을 누르고 팔로우가 확인되면</span>
          </>
        )}
        <p className="max-w-[88%] whitespace-pre-wrap rounded-[16px_16px_16px_6px] bg-bubble px-3.5 py-3 text-sm leading-relaxed">
          {dmText || "DM 내용"}
          {branding && <span className="mt-2 block text-xs text-muted-foreground">{branding}</span>}
        </p>
        <span className="flex h-[42px] max-w-[88%] items-center justify-center rounded-[10px] bg-foreground text-sm font-semibold text-white">
          {buttonTitle || "버튼"}
        </span>
      </div>
    </section>
  );
}
