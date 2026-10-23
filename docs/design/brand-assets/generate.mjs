// 링포 브랜드 이미지 묶음 만들기 — 디자인 A "블록 팝" (2026-10-23).
// 로고 패스는 앱의 로고 컴포넌트(src/components/brand/logo.tsx)에서 그대로 읽는다.
// HTML/SVG 를 헤드리스 크롬(Playwright)으로 찍어 PNG 로 만든다. PIL 같은 이미지 도구는 쓰지 않는다.
//
//   PLAYWRIGHT_FROM=<playwright 가 설치된 package.json 경로> node docs/design/brand-assets/generate.mjs
//
// 리눅스 서버에 시스템 라이브러리가 없으면 LD_LIBRARY_PATH 를 붙여 실행한다(만든 환경: 자비스 워커의 Playwright).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../../..");
const require = createRequire(process.env.PLAYWRIGHT_FROM ?? join(REPO, "package.json"));
const { chromium } = require("playwright");

const INK = "#1B1220", POP = "#D61F5C", YELLOW = "#FFD43B", WHITE = "#FFFFFF";
const logoSrc = readFileSync(join(REPO, "src/components/brand/logo.tsx"), "utf8");
const arr = (name) => JSON.parse(logoSrc.match(new RegExp(`const ${name} = (\\[.*?\\]);`))[1]);
const SYMBOL = arr("SYMBOL"), WORDMARK = arr("WORDMARK");
const sym = SYMBOL.map((d) => `<path d="${d}"/>`).join("");
const wm = WORDMARK.map((d) => `<path d="${d}"/>`).join("");
const symbolSvg = (color, size, x = 0, y = 0) =>
  `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 120 120" fill="none" stroke="${color}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">${sym}</svg>`;

// ── 벡터 원본 ──
const SVG = join(HERE, "svg");
mkdirSync(SVG, { recursive: true });
for (const old of ["ringpo-app-ink.svg", "ringpo-app-lime.svg", "ringpo-logo-lime.svg", "ringpo-symbol-lime.svg"]) rmSync(join(SVG, old), { force: true });
const xmlns = 'xmlns="http://www.w3.org/2000/svg"';
const symbolFile = (color) => `<svg ${xmlns} viewBox="0 0 120 120" fill="none" stroke="${color}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">${sym}</svg>`;
// 로고: 심볼 64 + 간격 12 + 워드마크 182x70 (높이 70 기준)
const logoFile = (symColor, wordColor) =>
  `<svg ${xmlns} viewBox="0 0 258 70">${symbolSvg(symColor, 64, 0, 3)}<g transform="translate(76 0)" fill="${wordColor}">${wm}</g></svg>`;
// 앱 아이콘(정사각, 모서리는 플랫폼이 깎는다): 96 격자에서 심볼 68 → 여백 14
const appFile = (bg, fg) => `<svg ${xmlns} viewBox="0 0 96 96"><rect width="96" height="96" fill="${bg}"/>${symbolSvg(fg, 68, 14, 14)}</svg>`;
const favicon = `<svg ${xmlns} viewBox="0 0 96 96"><rect width="96" height="96" rx="24" fill="${POP}"/>${symbolSvg(WHITE, 68, 14, 14)}</svg>`;
const files = {
  "ringpo-symbol-ink.svg": symbolFile(INK),
  "ringpo-symbol-white.svg": symbolFile(WHITE),
  "ringpo-symbol-pink.svg": symbolFile(POP),
  "ringpo-logo-ink.svg": logoFile(POP, INK), // 밝은 바탕 기본: 핑크 심볼 + 잉크 글자
  "ringpo-logo-white.svg": logoFile(WHITE, WHITE),
  "ringpo-logo-pink.svg": logoFile(POP, POP),
  "ringpo-app-pink.svg": appFile(POP, WHITE),
  "ringpo-app-yellow.svg": appFile(YELLOW, INK),
  "favicon.svg": favicon,
};
for (const [name, body] of Object.entries(files)) writeFileSync(join(SVG, name), body);

// ── PNG ──
for (const old of ["app-icon-lime-1024.png", "logo-lime-1032w.png"]) rmSync(join(HERE, old), { force: true });
const browser = await chromium.launch({ headless: true });
async function png(name, svg, w, h, transparent = false) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${w}" height="${h}" `)}</body></html>`);
  const buf = await page.screenshot({ type: "png", omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
  if (name) writeFileSync(join(HERE, name), buf);
  return buf;
}
const app = files["ringpo-app-pink.svg"];
await png("meta-app-icon-1024.png", app, 1024, 1024);
for (const n of [512, 256, 192]) await png(`app-icon-${n}.png`, app, n, n);
await png("apple-touch-icon-180.png", app, 180, 180);
await png("kakao-app-icon-128.png", app, 128, 128);
await png("app-icon-yellow-1024.png", files["ringpo-app-yellow.svg"], 1024, 1024);
// 프로필: 원형으로 잘려도 안전하게 심볼 56%, 살짝 아래로
const profile = `<svg ${xmlns} viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="${POP}"/>${symbolSvg(WHITE, 560, 220, 240)}</svg>`;
await png("profile-1080.png", profile, 1080, 1080);
await png("profile-640.png", profile, 640, 640);
await png("logo-ink-1032w.png", files["ringpo-logo-ink.svg"], 1032, 280, true);
await png("logo-white-1032w.png", files["ringpo-logo-white.svg"], 1032, 280, true);
await png("logo-pink-1032w.png", files["ringpo-logo-pink.svg"], 1032, 280, true);
// 파비콘: 둥근 타일(투명 모서리) 16/32/48 PNG 를 ICO 하나에
const sizes = [16, 32, 48];
const pngs = [];
for (const n of sizes) pngs.push(await png(null, favicon, n, n, true));
const head = Buffer.alloc(6);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = sizes.map((n, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(n, 0); e.writeUInt8(n, 1); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
writeFileSync(join(HERE, "favicon.ico"), Buffer.concat([head, ...dir, ...pngs]));
await browser.close();
console.log("done");
