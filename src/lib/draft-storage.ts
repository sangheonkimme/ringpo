/** 작성 중인 자동화를 브라우저에 잠깐 보관한다. 새로고침·배포로 화면이 다시 떠도 입력이 남도록 */
const MAX_AGE_MS = 24 * 3_600_000;

export function draftKey(automationId: string | undefined): string {
  return `ringpo:automation-draft:${automationId ?? "new"}`;
}

export function serializeDraft<T>(draft: T, step: number, now: Date): string {
  return JSON.stringify({ draft, step, savedAt: now.getTime() });
}

export function parseStoredDraft<T>(raw: string | null, now: Date): { draft: T; step: number } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { draft?: T; step?: number; savedAt?: number };
    if (!v.draft || typeof v.step !== "number" || typeof v.savedAt !== "number") return null;
    if (now.getTime() - v.savedAt > MAX_AGE_MS) return null;
    return { draft: v.draft, step: v.step };
  } catch {
    return null;
  }
}
