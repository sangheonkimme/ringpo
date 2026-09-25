import { site } from "@/lib/site";

export function renderReply(template: string, username: string | null): string {
  const mention = username ? `@${username}` : "";
  return template.replaceAll("{username}", mention).replace(/ {2,}/g, " ").trim();
}

export function truncateChars(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("");
}

const encoder = new TextEncoder();

export function truncateUtf8(text: string, maxBytes: number): string {
  if (encoder.encode(text).length <= maxBytes) return text;
  let out = "";
  let bytes = 0;
  for (const ch of text) {
    const b = encoder.encode(ch).length;
    if (bytes + b > maxBytes - 3) break;
    out += ch;
    bytes += b;
  }
  return `${out}...`;
}

/** Private Reply 텍스트 폴백: 본문 + 링크 줄, UTF-8 1000바이트 이내 */
export function buildTextFallback(text: string, buttonTitle: string, url: string): string {
  const suffix = `\n\n${buttonTitle}: ${url}`;
  return truncateUtf8(text, 1000 - encoder.encode(suffix).length) + suffix;
}

/** Free 플랜 DM 끝에 붙는 한 줄. 받는 사람에게 링포를 알리는 짧은 홍보 문구 */
export function brandingLine(): string {
  return `💬 무료 댓글 자동 DM · ${site.name}`;
}
