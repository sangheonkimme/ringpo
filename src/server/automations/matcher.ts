export type MatchType = "contains" | "exact" | "any";

export interface RuleLike {
  id: string;
  mediaScope: "specific" | "all" | "next";
  mediaId: string | null;
  keywords: string[];
  matchType: MatchType;
  createdAt: Date;
}

export function normalizeText(input: string): string {
  return input.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

// 앞뒤의 공백·구두점·기호(이모지 포함)·ZWJ·변형 선택자
const EDGE_NOISE = /^[\s\p{P}\p{S}\u200d\ufe0f]+|[\s\p{P}\p{S}\u200d\ufe0f]+$/gu;

export function matchesKeywords(comment: string, keywords: string[], matchType: MatchType): boolean {
  if (matchType === "any") return true;
  const text = normalizeText(comment);
  const normalized = keywords.map(normalizeText).filter((k) => k.length > 0);
  if (normalized.length === 0) return false;
  if (matchType === "contains") return normalized.some((k) => text.includes(k));
  const core = text.replace(EDGE_NOISE, "");
  return normalized.some((k) => core === k.replace(EDGE_NOISE, ""));
}

export function rulesToBind(rules: RuleLike[], mediaPublishedAt: Date | null): string[] {
  if (!mediaPublishedAt) return [];
  return rules
    .filter((r) => r.mediaScope === "next" && r.mediaId === null && r.createdAt < mediaPublishedAt)
    .map((r) => r.id);
}

/** 우선순위: 특정 게시물 > 모든 게시물, 같은 범위에서는 키워드 규칙 > 'any' 규칙, 그다음 최신순 */
export function selectAutomation<T extends RuleLike>(rules: T[], mediaId: string, commentText: string): T | null {
  const newestFirst = [...rules].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const specific = newestFirst.filter((r) => r.mediaScope === "specific" && r.mediaId === mediaId);
  const all = newestFirst.filter((r) => r.mediaScope === "all");
  const keywordFirst = (list: T[]) => [...list.filter((r) => r.matchType !== "any"), ...list.filter((r) => r.matchType === "any")];
  for (const r of [...keywordFirst(specific), ...keywordFirst(all)]) {
    if (matchesKeywords(commentText, r.keywords, r.matchType)) return r;
  }
  return null;
}
