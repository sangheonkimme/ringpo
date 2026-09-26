// 링포(ringpo) 디자인 시스템을 한 번에 만드는 Figma 개발용 플러그인 (v2).
// v2는 외주 디자이너 시안(ringpo-design-system-v1)의 로고·토큰 이름·상태·컴포넌트를 합친 버전이다.
// 다시 실행해도 안전하다: 변수와 스타일은 이름으로 찾아 값만 갱신하고,
// 이 플러그인이 만든 섹션(pluginData 표시)만 지운 뒤 다시 만든다. v1에서 이름이 바뀐 변수·스타일은 지운다.

const MARK = "ringpo-ds";
const notes = [];

// ---------------------------------------------------------------- 토큰 정의
// 원본 색. 이름과 값은 디자이너 토큰(docs/design/external-v1/tokens/ringpo.css)과 같다
const PRIMITIVES = [
  ["ink/950", "#0E1828"],
  ["ink/900", "#142338"],
  ["ink/800", "#20354F"],
  ["ink/700", "#304B68"],
  ["lime/500", "#CCF76B"],
  ["lime/600", "#B6E64F"],
  ["lime/50", "#F3FBDF"],
  ["white", "#FFFFFF"],
  ["gray/25", "#F6F8FA"],
  ["gray/50", "#F0F3F6"],
  ["gray/100", "#E6EBF0"],
  ["gray/200", "#D3DBE5"],
  ["gray/400", "#8793A3"],
  ["gray/500", "#6B7280"],
  ["gray/600", "#526075"],
  ["green/50", "#EAF6EE"],
  ["green/700", "#237245"],
  ["amber/50", "#FFF5E2"],
  ["amber/700", "#8A5B12"],
  ["red/50", "#FDECEC"],
  ["red/700", "#BC3636"],
  ["blue/500", "#4168DA"],
];

const BG = ["FRAME_FILL", "SHAPE_FILL"];
const TXT = ["TEXT_FILL"];
const STROKE = ["STROKE_COLOR"];
const ICON = ["SHAPE_FILL", "STROKE_COLOR"];
const FG = ["TEXT_FILL", "SHAPE_FILL", "STROKE_COLOR"];

// [의미 토큰, 참조할 원본 색, 쓰임새 범위]. 디자이너 토큰 37개 + 링포 추가 3개(icon/disabled, control/off, border/hover)
const SEMANTIC = [
  ["bg/canvas", "gray/25", BG],
  ["bg/surface", "white", BG],
  ["bg/subtle", "gray/50", BG],
  ["bg/brand", "ink/900", BG],
  ["bg/accent", "lime/500", BG],
  ["bg/accent-soft", "lime/50", BG],
  ["text/primary", "ink/900", TXT],
  ["text/secondary", "gray/600", TXT],
  ["text/tertiary", "gray/500", TXT],
  ["text/inverse", "white", TXT],
  ["text/disabled", "gray/400", TXT],
  ["border/default", "gray/200", STROKE],
  ["border/subtle", "gray/100", STROKE],
  ["border/hover", "gray/400", STROKE],
  ["border/focus", "blue/500", STROKE],
  ["action/primary/default", "ink/900", BG],
  ["action/primary/hover", "ink/800", BG],
  ["action/primary/pressed", "ink/950", BG],
  ["action/secondary/default", "white", BG],
  ["action/secondary/hover", "gray/25", BG],
  ["action/secondary/pressed", "gray/50", BG],
  ["action/disabled", "gray/100", BG],
  ["icon/default", "ink/900", ICON],
  ["icon/muted", "gray/500", ICON],
  ["icon/inverse", "white", ICON],
  ["icon/accent", "lime/500", ICON],
  ["icon/disabled", "gray/400", ICON],
  ["control/off", "gray/200", BG],
  ["status/success/bg", "green/50", BG],
  ["status/success/text", "green/700", FG],
  ["status/warning/bg", "amber/50", BG],
  ["status/warning/text", "amber/700", FG],
  ["status/danger/bg", "red/50", BG],
  ["status/danger/text", "red/700", FG],
  ["status/neutral/bg", "gray/50", BG],
  ["status/neutral/text", "gray/600", FG],
  ["sidebar/bg", "ink/900", BG],
  ["sidebar/hover", "ink/800", BG],
  ["sidebar/text", "gray/200", FG],
  ["sidebar/active", "lime/500", BG],
];

const SPACE = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64];

const RADIUS = [
  ["radius/4", 4],
  ["radius/8", 8],
  ["radius/12", 12],
  ["radius/16", 16],
  ["radius/24", 24],
  ["radius/full", 999],
];

// 모두 Pretendard(없으면 Noto Sans KR). 이름·크기·줄 높이는 디자이너 타입 스케일과 같다
const TYPE = [
  { name: "Heading/1", weight: "Bold", size: 32, lh: 42, ls: -2 },
  { name: "Heading/2", weight: "SemiBold", size: 24, lh: 34, ls: -1.5 },
  { name: "Heading/3", weight: "SemiBold", size: 20, lh: 30, ls: -1 },
  { name: "Body/Large", weight: "Regular", size: 16, lh: 26, ls: 0 },
  { name: "Body", weight: "Regular", size: 14, lh: 22, ls: 0 },
  { name: "Label", weight: "SemiBold", size: 14, lh: 22, ls: 0 },
  { name: "Caption", weight: "Regular", size: 12, lh: 18, ls: 0 },
  { name: "Caption/Strong", weight: "SemiBold", size: 12, lh: 18, ls: 0 },
  { name: "Metric", weight: "SemiBold", size: 36, lh: 46, ls: -2 },
];

// [이름, y, 흐림, Ink 불투명도]
const SHADOWS = [
  ["Shadow/Small", 1, 2, 0.06],
  ["Shadow/Medium", 8, 24, 0.1],
];

// v1에서 쓰던 이름. 다시 실행하면 지우고 위의 새 이름으로 만든다
const LEGACY_VARIABLES = {
  Primitives: ["lime/400", "cloud/50", "slate/100", "slate/150", "slate/200", "slate/300", "slate/400", "slate/500", "amber/500", "amber/800"],
  Color: [
    "bg/inverse", "bg/disabled", "text/placeholder", "text/on-brand", "icon/brand",
    "action/primary/bg", "action/primary/fg", "action/secondary/bg", "action/secondary/border", "action/secondary/fg",
    "action/disabled/bg", "action/disabled/fg", "control/on", "control/knob",
    "status/success/fg", "status/warning/fg", "status/warning/dot", "status/neutral/fg",
  ],
  Layout: [
    "spacing/2xs", "spacing/xs", "spacing/sm", "spacing/md", "spacing/lg", "spacing/xl", "spacing/2xl", "spacing/3xl",
    "radius/sm", "radius/md", "radius/lg", "radius/xl",
  ],
};
const LEGACY_TEXT_STYLES = ["Display/32 Bold", "Heading/24 Bold", "Body/16 Regular", "Body/16 SemiBold", "Label/14 Medium", "Caption/12 Regular", "Number/32 Bold"];

// Lucide 아이콘(ISC 라이선스) 경로. 24px 격자, 디자이너 규칙대로 선 1.75px·둥근 끝
const ICON_SVGS = [
  ["Home", "홈", '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'],
  ["Automation", "자동화", '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>'],
  ["Message", "메시지", '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'],
  ["Send", "보내기", '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>'],
  ["Link", "링크", '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'],
  ["Chart", "통계", '<path d="M6 20v-6"/><path d="M12 20V10"/><path d="M18 20V4"/>'],
  ["Bell", "알림", '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>'],
  ["Settings", "설정", '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'],
  ["Billing", "결제", '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>'],
  ["Plus", "추가", '<path d="M5 12h14"/><path d="M12 5v14"/>'],
  ["Check", "확인", '<path d="M20 6 9 17l-5-5"/>'],
  ["Close", "닫기", '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'],
  ["Chevron", "다음", '<path d="m9 18 6-6-6-6"/>'],
  ["Arrow", "이동", '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'],
  ["More", "더보기", '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'],
  ["Clock", "대기", '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'],
  ["Pause", "일시 정지", '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>'],
  ["External", "새 창", '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'],
  ["Help", "도움말", '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'],
  ["Search", "검색", '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.34-4.34"/>'],
  ["Loading", "로딩", '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>'],
  ["Clear", "지우기", '<circle cx="12" cy="12" r="10" fill="#8793A3" stroke="none"/><path d="m15 9-6 6" stroke="#FFFFFF"/><path d="m9 9 6 6" stroke="#FFFFFF"/>'],
];

// 디자이너 로고(말풍선 두 개를 이은 심볼 + ringpo 워드마크). 가져오기 오차가 없도록 transform을 경로에 풀어 넣었다
const SYMBOL_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"120\" height=\"120\" viewBox=\"0 0 120 120\"><g fill=\"none\" stroke=\"#142338\" stroke-width=\"13\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M 29,78 L 24,78 C 13,78 8,72 8,61 l 0,-8 c 0,-10 6,-17 17,-17 l 2,0 C 29,25 36,19 47,19 l 10,0 c 11,0 18,8 18,19 l 0,11 c 0,10 -6,15 -16,19 l -5,2 l 0,21\"/><path d=\"M 87,44 l 5,0 c 12,0 20,8 20,20 l 0,13 c 0,13 -8,22 -22,22 L 76,99 c -11,0 -18,-7 -18,-17 L 58,70\"/></g></svg>";
const WORDMARK_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"182\" height=\"68\" viewBox=\"0 0 182 68\"><g fill=\"#142338\"><path d=\"M 3.36,25.72 L 11.6,25.72 L 11.6,31.16 L 11.94,31.16 Q 12.77,28.28 14.78,26.78 Q 16.79,25.27 19.45,25.27 Q 20.83,25.27 22.18,25.55 L 22.18,33.17 Q 21.63,32.96 20.54,32.83 Q 19.46,32.69 18.53,32.69 Q 16.63,32.69 15.12,33.51 Q 13.61,34.33 12.74,35.83 Q 11.87,37.32 11.87,39.23 L 11.87,57.01 L 3.36,57.01 Z\"/><path d=\"M 26.37,25.72 L 34.88,25.72 L 34.88,57.01 L 26.37,57.01 Z M 25.95,17.29 Q 25.95,16.1 26.59,15.11 Q 27.23,14.12 28.3,13.54 Q 29.36,12.96 30.61,12.96 Q 31.89,12.96 32.95,13.54 Q 34.02,14.12 34.64,15.11 Q 35.27,16.1 35.27,17.29 Q 35.27,18.44 34.64,19.45 Q 34.02,20.46 32.95,21.04 Q 31.89,21.61 30.61,21.61 Q 29.36,21.61 28.3,21.04 Q 27.23,20.46 26.59,19.45 Q 25.95,18.44 25.95,17.29 Z\"/><path d=\"M 50.04,57.01 L 41.53,57.01 L 41.53,25.72 L 49.64,25.72 L 49.64,31.21 L 49.97,31.21 Q 51.09,28.44 53.51,26.88 Q 55.94,25.32 59.4,25.32 Q 62.66,25.32 65.08,26.73 Q 67.51,28.14 68.84,30.79 Q 70.17,33.44 70.17,37.07 L 70.17,57.01 L 61.66,57.01 L 61.66,38.55 Q 61.66,36.62 61,35.25 Q 60.35,33.88 59.09,33.14 Q 57.83,32.4 56.04,32.4 Q 54.26,32.4 52.89,33.17 Q 51.53,33.93 50.78,35.39 Q 50.04,36.85 50.04,38.88 Z\"/><path d=\"M 76.38,59.58 L 84.76,59.58 Q 85.15,61.42 86.76,62.32 Q 88.37,63.22 91,63.22 Q 94.13,63.22 95.88,61.78 Q 97.62,60.35 97.62,57.23 L 97.62,51.48 L 97.25,51.48 Q 96.57,52.96 95.45,54.06 Q 94.34,55.15 92.52,55.87 Q 90.71,56.58 88.31,56.58 Q 84.7,56.58 81.82,54.86 Q 78.94,53.13 77.26,49.67 Q 75.58,46.21 75.58,41.16 Q 75.58,36.05 77.28,32.47 Q 78.98,28.89 81.86,27.11 Q 84.74,25.32 88.3,25.32 Q 90.77,25.32 92.55,26.15 Q 94.34,26.98 95.35,28.13 Q 96.37,29.28 97.23,30.97 L 97.57,30.97 L 97.57,25.72 L 106.03,25.72 L 106.03,57.35 Q 106.03,61.21 104.11,63.94 Q 102.19,66.66 98.76,68.03 Q 95.33,69.4 90.8,69.4 Q 86.6,69.4 83.41,68.19 Q 80.23,66.97 78.43,64.76 Q 76.63,62.56 76.38,59.58 Z M 97.67,41.24 Q 97.67,38.46 96.88,36.4 Q 96.08,34.34 94.58,33.24 Q 93.09,32.14 90.96,32.14 Q 88.82,32.14 87.33,33.28 Q 85.83,34.42 85.06,36.47 Q 84.28,38.53 84.28,41.24 Q 84.28,43.97 85.06,45.96 Q 85.83,47.94 87.33,49.03 Q 88.82,50.12 90.96,50.12 Q 93.06,50.12 94.57,49.06 Q 96.08,47.99 96.88,46 Q 97.67,44.01 97.67,41.24 Z\"/><path d=\"M 112.68,25.72 L 121.05,25.72 L 121.05,30.97 L 121.47,30.97 Q 122.23,29.38 123.29,28.18 Q 124.35,26.98 126.13,26.15 Q 127.91,25.32 130.35,25.32 Q 133.91,25.32 136.79,27.13 Q 139.67,28.94 141.35,32.57 Q 143.04,36.2 143.04,41.39 Q 143.04,46.46 141.4,50.11 Q 139.76,53.77 136.87,55.64 Q 133.98,57.51 130.34,57.51 Q 127.96,57.51 126.18,56.71 Q 124.4,55.9 123.32,54.73 Q 122.23,53.57 121.47,52.03 L 121.19,52.03 L 121.19,68.76 L 112.68,68.76 Z M 127.69,50.7 Q 129.83,50.7 131.33,49.52 Q 132.84,48.33 133.6,46.23 Q 134.37,44.12 134.37,41.34 Q 134.37,38.58 133.6,36.5 Q 132.84,34.42 131.35,33.28 Q 129.85,32.14 127.69,32.14 Q 125.56,32.14 124.07,33.25 Q 122.57,34.37 121.77,36.44 Q 120.98,38.51 120.98,41.34 Q 120.98,44.14 121.77,46.26 Q 122.57,48.38 124.08,49.54 Q 125.59,50.7 127.69,50.7 Z\"/><path d=\"M 147.25,41.48 Q 147.25,36.64 149.12,33 Q 150.98,29.35 154.47,27.34 Q 157.95,25.32 162.61,25.32 Q 167.28,25.32 170.76,27.34 Q 174.25,29.35 176.11,33 Q 177.96,36.64 177.96,41.48 Q 177.96,46.26 176.11,49.92 Q 174.25,53.58 170.76,55.59 Q 167.28,57.61 162.61,57.61 Q 157.95,57.61 154.47,55.59 Q 150.98,53.58 149.12,49.92 Q 147.25,46.26 147.25,41.48 Z M 169.29,41.41 Q 169.29,38.64 168.54,36.47 Q 167.79,34.3 166.31,33.06 Q 164.82,31.82 162.68,31.82 Q 160.51,31.82 158.97,33.06 Q 157.44,34.3 156.67,36.45 Q 155.89,38.61 155.89,41.41 Q 155.89,44.22 156.67,46.38 Q 157.44,48.54 158.97,49.78 Q 160.51,51.01 162.68,51.01 Q 164.82,51.01 166.31,49.78 Q 167.79,48.54 168.54,46.36 Q 169.29,44.18 169.29,41.41 Z\"/></g></svg>";

// ---------------------------------------------------------------- 상태
const V = {}; // 변수 이름 → Variable
const S = {}; // 텍스트 스타일 이름 → TextStyle
const E = {}; // 효과 스타일 이름 → EffectStyle
const counts = { variables: 0, styles: 0, components: 0 };

function hexToRgb(hex) {
  const c = hex.replace("#", "");
  return { r: parseInt(c.slice(0, 2), 16) / 255, g: parseInt(c.slice(2, 4), 16) / 255, b: parseInt(c.slice(4, 6), 16) / 255 };
}

// 토큰 → 실제 hex. 연결이 빠지더라도 기본색이 맞게 보이도록 바탕색으로 쓴다
const HEX = {};
for (const [name, hex] of PRIMITIVES) HEX[name] = hex;
for (const [name, ref] of SEMANTIC) HEX[name] = HEX[ref];

function paint(token) {
  const v = V[token];
  if (!v) throw new Error("알 수 없는 토큰: " + token);
  return figma.variables.setBoundVariableForPaint({ type: "SOLID", color: hexToRgb(HEX[token]) }, "color", v);
}

function mark(node) {
  node.setPluginData(MARK, "1");
  return node;
}

// ---------------------------------------------------------------- 글꼴
async function resolveFonts() {
  const fonts = await figma.listAvailableFontsAsync();
  const byFamily = {};
  for (const f of fonts) {
    if (!byFamily[f.fontName.family]) byFamily[f.fontName.family] = [];
    byFamily[f.fontName.family].push(f.fontName.style);
  }
  const norm = (s) => s.toLowerCase().replace(/[\s_-]/g, "");
  const kr = ["Pretendard", "Pretendard Variable", "Pretendard JP", "Noto Sans KR"].find((c) => byFamily[c]);
  if (!kr) throw new Error("한글 글꼴(Pretendard 또는 Noto Sans KR)을 찾을 수 없어요");
  if (kr.indexOf("Pretendard") !== 0) notes.push("Pretendard가 없어 " + kr + "로 대체했어요");
  const FALLBACK = {
    semibold: ["semibold", "demibold", "bold"],
    medium: ["medium", "regular"],
    bold: ["bold", "extrabold"],
    regular: ["regular", "normal", "book"],
  };
  function style(weight) {
    const styles = byFamily[kr];
    const want = norm(weight);
    for (const w of FALLBACK[want] || [want]) {
      const m = styles.find((s) => norm(s) === w);
      if (m) return m;
    }
    return styles[0];
  }
  return { kr, style };
}

// ---------------------------------------------------------------- v1 정리
async function removeLegacy() {
  const colls = await figma.variables.getLocalVariableCollectionsAsync();
  const spacing = colls.find((c) => c.name === "Spacing");
  if (spacing && !colls.find((c) => c.name === "Layout")) spacing.name = "Layout";
  const collId = {};
  for (const c of colls) collId[c.name] = c.id;
  const vars = await figma.variables.getLocalVariablesAsync();
  let removed = 0;
  for (const coll of Object.keys(LEGACY_VARIABLES)) {
    const id = collId[coll];
    if (!id) continue;
    for (const v of vars) {
      if (v.variableCollectionId === id && LEGACY_VARIABLES[coll].indexOf(v.name) >= 0) {
        v.remove();
        removed++;
      }
    }
  }
  for (const s of await figma.getLocalTextStylesAsync()) {
    if (LEGACY_TEXT_STYLES.indexOf(s.name) >= 0) {
      s.remove();
      removed++;
    }
  }
  if (removed) notes.push("v1 변수·스타일 " + removed + "개를 새 이름으로 바꿨어요");
}

// ---------------------------------------------------------------- 변수
async function ensureCollection(name, modeName) {
  const all = await figma.variables.getLocalVariableCollectionsAsync();
  let c = all.find((x) => x.name === name);
  if (!c) c = figma.variables.createVariableCollection(name);
  if (c.modes[0].name !== modeName) c.renameMode(c.modes[0].modeId, modeName);
  return c;
}

function ensureVariable(all, coll, name, type) {
  let v = all.find((x) => x.variableCollectionId === coll.id && x.name === name);
  if (!v) {
    v = figma.variables.createVariable(name, coll, type);
    all.push(v);
  }
  counts.variables++;
  V[name] = v;
  return v;
}

const cssName = (name) => name.replace(/\//g, "-");

async function buildVariables() {
  const prim = await ensureCollection("Primitives", "Value");
  const color = await ensureCollection("Color", "Light");
  const layout = await ensureCollection("Layout", "Value");
  const all = await figma.variables.getLocalVariablesAsync();

  const pm = prim.modes[0].modeId;
  for (const [name, hex] of PRIMITIVES) {
    const v = ensureVariable(all, prim, name, "COLOR");
    v.setValueForMode(pm, hexToRgb(hex));
    v.scopes = []; // 원본 색은 선택 목록에서 숨기고 의미 토큰만 쓴다
    v.setVariableCodeSyntax("WEB", "var(--primitive-" + cssName(name) + ")");
    v.description = hex;
  }

  const cm = color.modes[0].modeId;
  for (const [name, ref, scopes] of SEMANTIC) {
    const v = ensureVariable(all, color, name, "COLOR");
    v.setValueForMode(cm, figma.variables.createVariableAlias(V[ref]));
    v.scopes = scopes;
    v.setVariableCodeSyntax("WEB", "var(--color-" + cssName(name) + ")");
  }

  const lm = layout.modes[0].modeId;
  for (const value of SPACE) {
    const v = ensureVariable(all, layout, "space/" + value, "FLOAT");
    v.setValueForMode(lm, value);
    v.scopes = ["GAP"];
    v.setVariableCodeSyntax("WEB", "var(--space-" + value + ")");
  }
  for (const [name, value] of RADIUS) {
    const v = ensureVariable(all, layout, name, "FLOAT");
    v.setValueForMode(lm, value);
    v.scopes = ["CORNER_RADIUS"];
    v.setVariableCodeSyntax("WEB", "var(--radius-" + value + ")");
  }
}

// ---------------------------------------------------------------- 텍스트·효과 스타일
async function buildTextStyles(fonts) {
  const existing = await figma.getLocalTextStylesAsync();
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  for (const t of TYPE) {
    const fontName = { family: fonts.kr, style: fonts.style(t.weight) };
    await figma.loadFontAsync(fontName);
    let s = existing.find((x) => x.name === t.name);
    if (!s) s = figma.createTextStyle();
    s.name = t.name;
    s.fontName = fontName;
    s.fontSize = t.size;
    s.lineHeight = { unit: "PIXELS", value: t.lh };
    s.letterSpacing = { unit: "PERCENT", value: t.ls };
    s.description = fontName.family + " " + fontName.style + " · " + t.size + "/" + t.lh;
    S[t.name] = s;
    counts.styles++;
  }
}

async function buildEffectStyles() {
  const existing = await figma.getLocalEffectStylesAsync();
  const ink = hexToRgb("#142338");
  for (const [name, y, radius, a] of SHADOWS) {
    let s = existing.find((x) => x.name === name);
    if (!s) s = figma.createEffectStyle();
    s.name = name;
    s.effects = [
      { type: "DROP_SHADOW", color: { r: ink.r, g: ink.g, b: ink.b, a: a }, offset: { x: 0, y: y }, radius: radius, spread: 0, visible: true, blendMode: "NORMAL" },
    ];
    s.description = "y " + y + " · 흐림 " + radius + " · Ink " + Math.round(a * 100) + "%";
    E[name] = s;
    counts.styles++;
  }
}

// ---------------------------------------------------------------- 노드 도우미
async function txt(chars, styleName, colorToken, name) {
  const st = S[styleName];
  const t = figma.createText();
  t.fontName = st.fontName;
  t.characters = chars;
  await t.setTextStyleIdAsync(st.id);
  t.fills = [paint(colorToken)];
  if (name) t.name = name;
  return t;
}

function af(name, dir, o) {
  o = o || {};
  const f = figma.createFrame();
  f.name = name;
  f.layoutMode = dir;
  f.primaryAxisSizingMode = "AUTO";
  f.counterAxisSizingMode = "AUTO";
  f.itemSpacing = o.gap || 0;
  const p = o.pad || [0, 0, 0, 0];
  f.paddingTop = p[0];
  f.paddingRight = p[1];
  f.paddingBottom = p[2];
  f.paddingLeft = p[3];
  f.primaryAxisAlignItems = o.main || "MIN";
  f.counterAxisAlignItems = o.cross || "MIN";
  f.fills = o.fill ? [paint(o.fill)] : [];
  if (o.radius !== undefined) f.cornerRadius = o.radius;
  f.clipsContent = false;
  return f;
}

// 자동 배치 프레임의 너비만 고정하고 높이는 내용에 맞춘다
function fixWidth(node, w) {
  node.resize(w, Math.max(1, node.height));
  node.layoutSizingHorizontal = "FIXED";
  node.layoutSizingVertical = "HUG";
}

function wrapGrid(name, width, gap, rowGap) {
  const f = af(name, "HORIZONTAL", { gap });
  f.resize(width, 10);
  f.layoutWrap = "WRAP";
  f.primaryAxisSizingMode = "FIXED";
  f.counterAxisSizingMode = "AUTO";
  f.counterAxisSpacing = rowGap;
  return f;
}

function bindSpace(node, field, token) {
  node.setBoundVariable(field, V[token]);
}

function bindPad(node, v, h) {
  bindSpace(node, "paddingTop", v);
  bindSpace(node, "paddingBottom", v);
  bindSpace(node, "paddingLeft", h);
  bindSpace(node, "paddingRight", h);
}

function bindRadius(node, token) {
  for (const k of ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"]) node.setBoundVariable(k, V[token]);
}

function stroke(node, token, weight, align) {
  node.strokes = [paint(token)];
  node.strokeWeight = weight;
  node.strokeAlign = align || "INSIDE";
}

// 포커스 링: 바깥쪽 2px 파란 선
function focusRing(node) {
  stroke(node, "border/focus", 2, "OUTSIDE");
}

// 인스턴스·SVG 안의 도형을 한 토큰으로 칠한다. 원래 선·채움이 있던 도형만 바꾸고 틀(프레임)은 투명하게 둔다
function tint(node, token) {
  for (const n of node.findAll(() => true)) {
    if (n.type === "TEXT") continue;
    if ("strokes" in n && n.strokes.length > 0) n.strokes = [paint(token)];
    const shape = n.type !== "FRAME" && n.type !== "INSTANCE" && n.type !== "COMPONENT";
    if (shape && "fills" in n && Array.isArray(n.fills) && n.fills.length > 0) n.fills = [paint(token)];
  }
}

function variant(set, name) {
  const v = set.children.find((c) => c.name === name);
  if (!v) throw new Error(set.name + "에 " + name + " 변형이 없어요");
  return v;
}

function variantProps(node) {
  const props = {};
  for (const part of node.name.split(", ")) {
    const kv = part.split("=");
    props[kv[0]] = kv[1];
  }
  return props;
}

function propKey(set, prop) {
  const key = Object.keys(set.componentPropertyDefinitions).find((k) => k.split("#")[0] === prop);
  if (!key) throw new Error(set.name + "에 " + prop + " 속성이 없어요");
  return key;
}

function props(set, values) {
  const out = {};
  for (const k of Object.keys(values)) out[propKey(set, k)] = values[k];
  return out;
}

function textIn(node, name) {
  return node.findOne((n) => n.type === "TEXT" && n.name === name);
}

function iconIn(node) {
  return node.findOne((n) => n.type === "INSTANCE" && n.name === "Icon");
}

// 변형을 격자로 놓는다. colOf/rowOf는 변형 속성을 받아 열·행 값을 돌려준다
function gridVariants(set, cols, colOf, rows, rowOf) {
  const gap = 24;
  const pad = 24;
  let cw = 0;
  let rh = 0;
  for (const ch of set.children) {
    cw = Math.max(cw, ch.width);
    rh = Math.max(rh, ch.height);
  }
  const rowCount = rows ? rows.length : 1;
  for (const ch of set.children) {
    const p = variantProps(ch);
    const ci = Math.max(0, cols.indexOf(colOf(p)));
    const ri = rows ? Math.max(0, rows.indexOf(rowOf(p))) : 0;
    ch.x = pad + ci * (cw + gap);
    ch.y = pad + ri * (rh + gap);
  }
  set.resizeWithoutConstraints(pad * 2 + cols.length * cw + (cols.length - 1) * gap, pad * 2 + rowCount * rh + (rowCount - 1) * gap);
}

function finishSet(set, name, description) {
  set.name = name;
  set.description = description;
  counts.components++;
  return set;
}

async function section(title, desc, content) {
  const s = figma.createSection();
  s.name = title;
  const wrap = af(title, "VERTICAL", { gap: 32, pad: [56, 56, 56, 56] });
  const head = af("Header", "VERTICAL", { gap: 8 });
  head.appendChild(await txt(title, "Heading/1", "text/primary", "Title"));
  if (desc) head.appendChild(await txt(desc, "Body/Large", "text/secondary", "Description"));
  wrap.appendChild(head);
  wrap.appendChild(content);
  s.appendChild(wrap);
  wrap.x = 0;
  wrap.y = 0;
  s.resizeWithoutConstraints(wrap.width, wrap.height);
  return mark(s);
}

function stack(nodes) {
  let y = 0;
  for (const n of nodes) {
    n.x = 0;
    n.y = y;
    y += n.height + 120;
  }
}

async function componentBlock(title, desc, node) {
  const block = af(title, "VERTICAL", { gap: 16 });
  block.appendChild(await txt(title, "Heading/2", "text/primary", "Title"));
  if (desc) block.appendChild(await txt(desc, "Body", "text/secondary", "Description"));
  block.appendChild(node);
  return block;
}

// SVG를 가져와 틀 프레임 없이 도형만 컴포넌트로 옮긴다
function svgComponent(svg, name, w, h) {
  const frame = figma.createNodeFromSvg(svg);
  const c = figma.createComponent();
  c.name = name;
  c.resize(w, h);
  c.fills = [];
  c.clipsContent = false;
  for (const ch of frame.children.slice()) c.appendChild(ch);
  frame.remove();
  for (const n of c.findAll(() => true)) {
    if ("constraints" in n) n.constraints = { horizontal: "SCALE", vertical: "SCALE" };
  }
  return c;
}

// ---------------------------------------------------------------- 브랜드
async function buildBrand(parent) {
  const symbol = svgComponent(SYMBOL_SVG, "Symbol", 120, 120);
  tint(symbol, "icon/default");
  symbol.description = "링포 심볼. 말풍선 두 개를 이어 만든 마크 · 120 격자 · 선 13 · 둥근 끝. 크기는 Scale 도구(K)로 바꿔야 선 두께가 같이 줄어요.";
  parent.appendChild(symbol);
  counts.components++;

  const logos = [];
  for (const [color, token] of [["Ink", "icon/default"], ["Lime", "icon/accent"], ["White", "icon/inverse"]]) {
    const c = figma.createComponent();
    c.name = "Color=" + color;
    c.layoutMode = "HORIZONTAL";
    c.primaryAxisSizingMode = "AUTO";
    c.counterAxisSizingMode = "AUTO";
    c.counterAxisAlignItems = "CENTER";
    bindSpace(c, "itemSpacing", "space/12");
    c.fills = [];
    const mark = symbol.createInstance();
    mark.name = "Symbol";
    mark.rescale(64 / 120);
    tint(mark, token);
    c.appendChild(mark);
    const wm = figma.createNodeFromSvg(WORDMARK_SVG);
    wm.name = "Wordmark";
    wm.fills = [];
    wm.clipsContent = false;
    tint(wm, token);
    c.appendChild(wm);
    logos.push(c);
  }
  const logo = figma.combineAsVariants(logos, parent);
  gridVariants(logo, ["Ink", "Lime", "White"], (p) => p.Color);
  logo.fills = [paint("gray/400")]; // 흰 로고도 보이도록 중간 회색 바탕
  finishSet(logo, "Logo", "심볼 + ringpo 워드마크. 밝은 바탕엔 Ink, 어두운 바탕엔 White나 Lime을 써요. 크기는 Scale 도구(K)로 바꿔요.");

  const apps = [];
  for (const [style, bg, fg] of [["Ink", "bg/brand", "icon/accent"], ["Lime", "bg/accent", "icon/default"]]) {
    const c = figma.createComponent();
    c.name = "Style=" + style;
    c.layoutMode = "HORIZONTAL";
    c.primaryAxisAlignItems = "CENTER";
    c.counterAxisAlignItems = "CENTER";
    c.resize(96, 96);
    c.primaryAxisSizingMode = "FIXED";
    c.counterAxisSizingMode = "FIXED";
    bindRadius(c, "radius/24");
    c.fills = [paint(bg)];
    c.clipsContent = true;
    const mark = symbol.createInstance();
    mark.name = "Symbol";
    mark.rescale(68 / 120);
    tint(mark, fg);
    c.appendChild(mark);
    apps.push(c);
  }
  const app = figma.combineAsVariants(apps, parent);
  gridVariants(app, ["Ink", "Lime"], (p) => p.Style);
  finishSet(app, "App Icon", "앱 아이콘 96 · 모서리 24. Ink 바탕에 라임 심볼, 라임 바탕에 Ink 심볼.");
  return { symbol, logo, app };
}

// ---------------------------------------------------------------- 컴포넌트
async function buildIcons(parent) {
  const icons = {};
  for (const [name, label, inner] of ICON_SVGS) {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#142338" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' +
      inner +
      "</svg>";
    const c = svgComponent(svg, "Icon/" + name, 24, 24);
    const clear = name === "Clear";
    for (const n of c.findAll(() => true)) {
      if ("strokes" in n && n.strokes.length > 0) n.strokes = [paint(clear ? "icon/inverse" : "icon/default")];
      if ("fills" in n && Array.isArray(n.fills) && n.fills.length > 0) n.fills = [paint(clear ? "icon/disabled" : "icon/default")];
    }
    c.description = label + " 아이콘 · 24px · 선 1.75px (Lucide 기반)";
    const cell = af(name, "VERTICAL", { gap: 8, cross: "CENTER" });
    cell.resize(72, 60);
    cell.primaryAxisSizingMode = "AUTO";
    cell.counterAxisSizingMode = "FIXED";
    cell.appendChild(c);
    cell.appendChild(await txt(label, "Caption", "text/secondary", "Label"));
    parent.appendChild(cell);
    icons[name] = c;
    counts.components++;
  }
  return icons;
}

const BUTTON_STATES = ["Default", "Hover", "Pressed", "Focus", "Disabled", "Loading"];
const BUTTON_SIZES = { Medium: { h: 44, pad: "space/16", icon: 20 }, Small: { h: 36, pad: "space/12", icon: 16 } };

function buttonColors(style, state) {
  if (state === "Disabled") return { bg: "action/disabled", fg: "text/disabled", icon: "icon/disabled", border: style === "Secondary" ? "border/subtle" : null };
  const primary = style === "Primary";
  const tone = state === "Hover" ? "hover" : state === "Pressed" ? "pressed" : "default";
  return {
    bg: "action/" + (primary ? "primary" : "secondary") + "/" + tone,
    fg: primary ? "text/inverse" : "text/primary",
    icon: primary ? "icon/inverse" : "icon/default",
    border: primary ? null : "border/default",
  };
}

async function buildButton(icons, parent) {
  const comps = [];
  for (const style of ["Primary", "Secondary"]) {
    for (const size of ["Medium", "Small"]) {
      const sz = BUTTON_SIZES[size];
      for (const state of BUTTON_STATES) {
        const col = buttonColors(style, state);
        const c = figma.createComponent();
        c.name = "Style=" + style + ", Size=" + size + ", State=" + state;
        c.layoutMode = "HORIZONTAL";
        c.primaryAxisAlignItems = "CENTER";
        c.counterAxisAlignItems = "CENTER";
        c.resize(120, sz.h);
        c.primaryAxisSizingMode = "AUTO";
        c.counterAxisSizingMode = "FIXED";
        bindSpace(c, "paddingLeft", sz.pad);
        bindSpace(c, "paddingRight", sz.pad);
        bindSpace(c, "itemSpacing", "space/8");
        bindRadius(c, "radius/12");
        c.fills = [paint(col.bg)];
        if (state === "Focus") focusRing(c);
        else if (col.border) stroke(c, col.border, 1);
        else c.strokes = [];
        const icon = (state === "Loading" ? icons.Loading : icons.Plus).createInstance();
        icon.name = "Icon";
        icon.resize(sz.icon, sz.icon);
        tint(icon, col.icon);
        icon.visible = state !== "Disabled";
        c.appendChild(icon);
        c.appendChild(await txt("자동화 만들기", "Label", col.fg, "Label"));
        comps.push(c);
      }
    }
  }
  const set = figma.combineAsVariants(comps, parent);
  gridVariants(set, BUTTON_STATES, (p) => p.State, ["Primary/Medium", "Primary/Small", "Secondary/Medium", "Secondary/Small"], (p) => p.Style + "/" + p.Size);
  const labelKey = set.addComponentProperty("Label", "TEXT", "자동화 만들기");
  const showKey = set.addComponentProperty("Show icon", "BOOLEAN", true);
  const iconKey = set.addComponentProperty("Icon", "INSTANCE_SWAP", icons.Plus.id);
  for (const v of set.children) {
    const state = variantProps(v).State;
    textIn(v, "Label").componentPropertyReferences = { characters: labelKey };
    // 비활성은 아이콘을 숨긴 채 두고(Show icon에 묶지 않음), 로딩은 로딩 아이콘을 고정한다
    if (state === "Disabled") iconIn(v).componentPropertyReferences = { mainComponent: iconKey };
    else if (state !== "Loading") iconIn(v).componentPropertyReferences = { visible: showKey, mainComponent: iconKey };
  }
  return finishSet(
    set,
    "Button",
    "Primary는 화면당 핵심 동작 하나, Secondary는 보조 동작. Medium 44 · Small 36 · 모서리 12. 포커스는 바깥 파란 링, 비활성은 아이콘 없이 보여요.",
  );
}

async function buildIconButton(icons, parent) {
  const states = ["Default", "Hover", "Focus", "Disabled"];
  const comps = [];
  for (const style of ["Ghost", "Surface"]) {
    for (const state of states) {
      const c = figma.createComponent();
      c.name = "Style=" + style + ", State=" + state;
      c.layoutMode = "HORIZONTAL";
      c.primaryAxisAlignItems = "CENTER";
      c.counterAxisAlignItems = "CENTER";
      c.resize(44, 44);
      c.primaryAxisSizingMode = "FIXED";
      c.counterAxisSizingMode = "FIXED";
      bindRadius(c, "radius/12");
      const hover = state === "Hover";
      if (style === "Ghost") c.fills = hover ? [paint("bg/subtle")] : [];
      else c.fills = [paint(state === "Disabled" ? "action/disabled" : hover ? "action/secondary/hover" : "action/secondary/default")];
      if (state === "Focus") focusRing(c);
      else if (style === "Surface" && state !== "Disabled") stroke(c, "border/default", 1);
      else c.strokes = [];
      const icon = icons.Bell.createInstance();
      icon.name = "Icon";
      icon.resize(20, 20);
      tint(icon, state === "Disabled" ? "icon/disabled" : "icon/default");
      c.appendChild(icon);
      comps.push(c);
    }
  }
  const set = figma.combineAsVariants(comps, parent);
  gridVariants(set, states, (p) => p.State, ["Ghost", "Surface"], (p) => p.Style);
  const iconKey = set.addComponentProperty("Icon", "INSTANCE_SWAP", icons.Bell.id);
  for (const v of set.children) iconIn(v).componentPropertyReferences = { mainComponent: iconKey };
  return finishSet(set, "Icon Button", "아이콘만 있는 버튼 · 44×44 터치 영역. Ghost는 바탕 없이, Surface는 흰 바탕에 테두리. Icon 속성으로 모양을 바꿔요.");
}

const BADGE_TONES = [
  ["Neutral", "초안", "status/neutral/bg", "status/neutral/text"],
  ["Success", "실행 중", "status/success/bg", "status/success/text"],
  ["Warning", "일시 정지", "status/warning/bg", "status/warning/text"],
  ["Danger", "확인 필요", "status/danger/bg", "status/danger/text"],
];

async function buildBadge(parent) {
  const comps = [];
  for (const [tone, label, bg, fg] of BADGE_TONES) {
    const c = figma.createComponent();
    c.name = "Tone=" + tone;
    c.layoutMode = "HORIZONTAL";
    c.primaryAxisSizingMode = "AUTO";
    c.counterAxisSizingMode = "AUTO";
    c.counterAxisAlignItems = "CENTER";
    bindPad(c, "space/4", "space/8");
    bindSpace(c, "itemSpacing", "space/4");
    bindRadius(c, "radius/full");
    c.fills = [paint(bg)];
    const dot = figma.createEllipse();
    dot.name = "Dot";
    dot.resize(6, 6);
    dot.fills = [paint(fg)];
    c.appendChild(dot);
    c.appendChild(await txt(label, "Caption/Strong", fg, "Label"));
    comps.push(c);
  }
  const set = figma.combineAsVariants(comps, parent);
  gridVariants(set, BADGE_TONES.map((t) => t[0]), (p) => p.Tone);
  return finishSet(set, "Badge", "상태는 색과 문구로 함께 알려요. 성공(실행 중·발송 완료) · 주의(일시 정지·일부 완료) · 위험(확인 필요·실패) · 중립(초안·건너뜀). 문구는 글자 레이어를 직접 고쳐 써요.");
}

async function buildChip(icons, parent) {
  const c = figma.createComponent();
  c.name = "Chip";
  c.layoutMode = "HORIZONTAL";
  c.counterAxisAlignItems = "CENTER";
  c.resize(80, 40);
  c.primaryAxisSizingMode = "AUTO";
  c.counterAxisSizingMode = "FIXED";
  bindSpace(c, "paddingLeft", "space/16");
  bindSpace(c, "paddingRight", "space/12");
  bindSpace(c, "itemSpacing", "space/8");
  bindRadius(c, "radius/full");
  c.fills = [paint("bg/surface")];
  stroke(c, "border/default", 1);
  const label = await txt("링크", "Body/Large", "text/primary", "Label");
  c.appendChild(label);
  const x = icons.Close.createInstance();
  x.name = "Remove";
  x.resize(16, 16);
  tint(x, "icon/muted");
  c.appendChild(x);
  const labelKey = c.addComponentProperty("Label", "TEXT", "링크");
  const removableKey = c.addComponentProperty("Removable", "BOOLEAN", true);
  label.componentPropertyReferences = { characters: labelKey };
  x.componentPropertyReferences = { visible: removableKey };
  c.description = "댓글 키워드 칩 · 높이 40. Removable을 끄면 X 버튼이 사라져요.";
  parent.appendChild(c);
  counts.components++;
  return c;
}

// 기본 상태의 켜짐 ↔ 꺼짐을 클릭으로 오가게 한다(프로토타입 실행 모드)
async function linkOnOff(set, a, b) {
  const va = variant(set, a);
  const vb = variant(set, b);
  try {
    await va.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: [{ type: "NODE", destinationId: vb.id, navigation: "CHANGE_TO", transition: null }] }]);
    await vb.setReactionsAsync([{ trigger: { type: "ON_CLICK" }, actions: [{ type: "NODE", destinationId: va.id, navigation: "CHANGE_TO", transition: null }] }]);
  } catch (e) {
    notes.push(set.name + " 클릭 전환 연결을 건너뛰었어요");
  }
}

async function buildToggle(parent) {
  const states = ["Default", "Focus", "Disabled"];
  const comps = [];
  for (const value of ["On", "Off"]) {
    for (const state of states) {
      const c = figma.createComponent();
      c.name = "Value=" + value + ", State=" + state;
      c.layoutMode = "HORIZONTAL";
      c.resize(52, 32);
      c.primaryAxisSizingMode = "FIXED";
      c.counterAxisSizingMode = "FIXED";
      c.primaryAxisAlignItems = value === "On" ? "MAX" : "MIN";
      c.counterAxisAlignItems = "CENTER";
      c.paddingTop = 3;
      c.paddingBottom = 3;
      c.paddingLeft = 3;
      c.paddingRight = 3;
      bindRadius(c, "radius/full");
      c.fills = [paint(value === "On" ? "bg/accent" : "control/off")];
      if (state === "Focus") focusRing(c);
      if (state === "Disabled") c.opacity = 0.4;
      const knob = figma.createEllipse();
      knob.name = "Knob";
      knob.resize(26, 26);
      // 켜짐은 Ink 손잡이: 흰 손잡이는 라임 트랙 위에서 대비가 1.2:1이라 잘 안 보인다
      knob.fills = [paint(value === "On" ? "action/primary/default" : "bg/surface")];
      await knob.setEffectStyleIdAsync(E["Shadow/Small"].id);
      c.appendChild(knob);
      comps.push(c);
    }
  }
  const set = figma.combineAsVariants(comps, parent);
  gridVariants(set, states, (p) => p.State, ["On", "Off"], (p) => p.Value);
  await linkOnOff(set, "Value=On, State=Default", "Value=Off, State=Default");
  return finishSet(set, "Toggle", "켜고 끄는 스위치 · 52×32. 켜짐은 라임 트랙에 Ink 손잡이, 꺼짐은 회색 트랙에 흰 손잡이. 프로토타입 실행 모드에서 클릭하면 바뀌어요.");
}

async function buildCheckbox(icons, parent) {
  const states = ["Default", "Disabled"];
  const comps = [];
  for (const value of ["On", "Off"]) {
    for (const state of states) {
      const on = value === "On";
      const c = figma.createComponent();
      c.name = "Value=" + value + ", State=" + state;
      c.layoutMode = "HORIZONTAL";
      c.primaryAxisSizingMode = "AUTO";
      c.counterAxisSizingMode = "AUTO";
      c.counterAxisAlignItems = "CENTER";
      bindSpace(c, "itemSpacing", "space/12");
      c.fills = [];
      if (state === "Disabled") c.opacity = 0.4;
      const box = af("Box", "HORIZONTAL", { main: "CENTER", cross: "CENTER" });
      box.resize(20, 20);
      box.primaryAxisSizingMode = "FIXED";
      box.counterAxisSizingMode = "FIXED";
      bindRadius(box, "radius/4");
      box.fills = [paint(on ? "action/primary/default" : "bg/surface")];
      if (!on) stroke(box, "border/hover", 1.5);
      const check = icons.Check.createInstance();
      check.name = "Check";
      check.resize(14, 14);
      tint(check, "icon/inverse");
      check.visible = on;
      box.appendChild(check);
      c.appendChild(box);
      c.appendChild(await txt("선택한 게시물에 적용", "Body", "text/primary", "Label"));
      comps.push(c);
    }
  }
  const set = figma.combineAsVariants(comps, parent);
  gridVariants(set, states, (p) => p.State, ["On", "Off"], (p) => p.Value);
  const labelKey = set.addComponentProperty("Label", "TEXT", "선택한 게시물에 적용");
  for (const v of set.children) textIn(v, "Label").componentPropertyReferences = { characters: labelKey };
  await linkOnOff(set, "Value=On, State=Default", "Value=Off, State=Default");
  return finishSet(set, "Checkbox", "체크박스 + 설명 · 상자 20. 체크하면 Ink 바탕에 흰 체크. 프로토타입에서 클릭하면 바뀌어요.");
}

const INPUT_STATES = {
  Default: { value: "키워드를 입력하세요", fg: "text/tertiary", line: "border/default", w: 1 },
  Hover: { value: "키워드를 입력하세요", fg: "text/tertiary", line: "border/hover", w: 1 },
  Focus: { value: "정보", fg: "text/primary", line: "border/focus", w: 2, clear: true },
  Filled: { value: "정보, 링크, 가격", fg: "text/primary", line: "border/default", w: 1 },
  Error: { value: "키워드를 입력하세요", fg: "text/tertiary", line: "status/danger/text", w: 1.5, error: "키워드를 한 개 이상 입력해 주세요." },
  Disabled: { value: "정보", fg: "text/disabled", line: "border/subtle", w: 1, fill: "bg/subtle" },
};

async function buildInput(icons, parent) {
  const states = Object.keys(INPUT_STATES);
  const comps = [];
  for (const state of states) {
    const st = INPUT_STATES[state];
    const c = figma.createComponent();
    c.name = "State=" + state;
    c.layoutMode = "VERTICAL";
    c.resize(360, 100);
    c.primaryAxisSizingMode = "AUTO";
    c.counterAxisSizingMode = "FIXED";
    bindSpace(c, "itemSpacing", "space/8");
    c.fills = [];
    c.appendChild(await txt("댓글 키워드", "Label", "text/primary", "Label"));

    const field = figma.createFrame();
    field.name = "Field";
    field.layoutMode = "HORIZONTAL";
    field.counterAxisAlignItems = "CENTER";
    field.resize(360, 44);
    field.primaryAxisSizingMode = "FIXED";
    field.counterAxisSizingMode = "FIXED";
    bindSpace(field, "paddingLeft", "space/16");
    bindSpace(field, "paddingRight", "space/12");
    bindSpace(field, "itemSpacing", "space/8");
    bindRadius(field, "radius/12");
    field.fills = [paint(st.fill || "bg/surface")];
    stroke(field, st.line, st.w);
    c.appendChild(field);
    field.layoutSizingHorizontal = "FILL";

    // 입력 글자는 16px: iOS Safari는 16px보다 작은 입력창을 누르면 화면을 확대한다
    const value = await txt(st.value, "Body/Large", st.fg, "Value");
    field.appendChild(value);
    value.layoutSizingHorizontal = "FILL";
    value.textAutoResize = "HEIGHT";

    const clear = icons.Clear.createInstance();
    clear.name = "Clear";
    clear.resize(20, 20);
    clear.visible = Boolean(st.clear);
    field.appendChild(clear);

    const helper = await txt(st.error || "쉼표로 여러 키워드를 구분할 수 있어요.", "Caption", st.error ? "status/danger/text" : "text/tertiary", "Helper");
    c.appendChild(helper);
    comps.push(c);
  }
  const set = figma.combineAsVariants(comps, parent);
  gridVariants(set, states, (p) => p.State);
  const labelKey = set.addComponentProperty("Label", "TEXT", "댓글 키워드");
  const helperKey = set.addComponentProperty("Show helper", "BOOLEAN", true);
  for (const v of set.children) {
    textIn(v, "Label").componentPropertyReferences = { characters: labelKey };
    textIn(v, "Helper").componentPropertyReferences = { visible: helperKey };
  }
  return finishSet(set, "Input", "입력창 · 높이 44 · 입력 글자 16px(iOS 확대 방지). 라벨은 항상 보이고, 오류는 빨간 테두리와 구체적인 안내로 알려요. 값·안내 문구는 레이어를 직접 고쳐 써요.");
}

async function buildNavItem(icons, parent) {
  const states = ["Default", "Hover", "Active"];
  const comps = [];
  for (const state of states) {
    const active = state === "Active";
    const c = figma.createComponent();
    c.name = "State=" + state;
    c.layoutMode = "HORIZONTAL";
    c.counterAxisAlignItems = "CENTER";
    c.resize(200, 44);
    c.primaryAxisSizingMode = "FIXED";
    c.counterAxisSizingMode = "FIXED";
    bindSpace(c, "paddingLeft", "space/12");
    bindSpace(c, "paddingRight", "space/12");
    bindSpace(c, "itemSpacing", "space/12");
    bindRadius(c, "radius/12");
    c.fills = active ? [paint("sidebar/active")] : state === "Hover" ? [paint("sidebar/hover")] : [];
    const icon = icons.Home.createInstance();
    icon.name = "Icon";
    icon.resize(20, 20);
    tint(icon, active ? "icon/default" : "sidebar/text");
    c.appendChild(icon);
    c.appendChild(await txt("홈", "Label", active ? "text/primary" : "sidebar/text", "Label"));
    comps.push(c);
  }
  const set = figma.combineAsVariants(comps, parent);
  set.fills = [paint("sidebar/bg")]; // 어두운 사이드바 위에서 쓰는 컴포넌트
  gridVariants(set, states, (p) => p.State);
  const labelKey = set.addComponentProperty("Label", "TEXT", "홈");
  const iconKey = set.addComponentProperty("Icon", "INSTANCE_SWAP", icons.Home.id);
  for (const v of set.children) {
    textIn(v, "Label").componentPropertyReferences = { characters: labelKey };
    iconIn(v).componentPropertyReferences = { mainComponent: iconKey };
  }
  return finishSet(set, "Nav Item", "데스크톱 사이드바 메뉴(Ink 바탕). 선택된 메뉴는 라임으로 채워요. 메뉴: 홈 · 자동화 · 결제 · 설정.");
}

async function buildTabItem(icons, parent) {
  const states = ["Default", "Active"];
  const comps = [];
  for (const state of states) {
    const active = state === "Active";
    const c = figma.createComponent();
    c.name = "State=" + state;
    c.layoutMode = "VERTICAL";
    c.primaryAxisAlignItems = "CENTER";
    c.counterAxisAlignItems = "CENTER";
    c.resize(88, 58);
    c.primaryAxisSizingMode = "FIXED";
    c.counterAxisSizingMode = "FIXED";
    bindSpace(c, "itemSpacing", "space/4");
    c.fills = [];
    const icon = icons.Home.createInstance();
    icon.name = "Icon";
    icon.resize(22, 22);
    tint(icon, active ? "icon/default" : "icon/muted");
    c.appendChild(icon);
    c.appendChild(await txt("홈", active ? "Caption/Strong" : "Caption", active ? "text/primary" : "text/tertiary", "Label"));
    comps.push(c);
  }
  const set = figma.combineAsVariants(comps, parent);
  gridVariants(set, states, (p) => p.State);
  const labelKey = set.addComponentProperty("Label", "TEXT", "홈");
  const iconKey = set.addComponentProperty("Icon", "INSTANCE_SWAP", icons.Home.id);
  for (const v of set.children) {
    textIn(v, "Label").componentPropertyReferences = { characters: labelKey };
    iconIn(v).componentPropertyReferences = { mainComponent: iconKey };
  }
  return finishSet(set, "Tab Bar Item", "모바일 아래 탭 메뉴 한 칸 · 88×58. 네 칸(홈 · 자동화 · 결제 · 설정)을 나란히 놓아요.");
}

async function buildMetricCard(icons, parent) {
  const comps = [];
  for (const style of ["Default", "Accent"]) {
    const c = figma.createComponent();
    c.name = "Style=" + style;
    c.layoutMode = "VERTICAL";
    c.resize(264, 140);
    c.primaryAxisSizingMode = "AUTO";
    c.counterAxisSizingMode = "FIXED";
    bindPad(c, "space/24", "space/24");
    bindSpace(c, "itemSpacing", "space/8");
    bindRadius(c, "radius/16");
    c.fills = [paint(style === "Accent" ? "bg/accent-soft" : "bg/surface")];
    stroke(c, "border/subtle", 1);
    const top = af("Top", "HORIZONTAL", { main: "SPACE_BETWEEN", cross: "CENTER" });
    c.appendChild(top);
    top.layoutSizingHorizontal = "FILL";
    top.appendChild(await txt("보낸 DM", "Body", "text/secondary", "Label"));
    const icon = icons.Send.createInstance();
    icon.name = "Icon";
    icon.resize(20, 20);
    tint(icon, "icon/default");
    top.appendChild(icon);
    c.appendChild(await txt("1,248", "Metric", "text/primary", "Value"));
    c.appendChild(await txt("지난주보다 18% 늘었어요", "Caption", "text/tertiary", "Caption"));
    comps.push(c);
  }
  const set = figma.combineAsVariants(comps, parent);
  gridVariants(set, ["Default", "Accent"], (p) => p.Style);
  const keys = {
    Label: set.addComponentProperty("Label", "TEXT", "보낸 DM"),
    Value: set.addComponentProperty("Value", "TEXT", "1,248"),
    Caption: set.addComponentProperty("Caption", "TEXT", "지난주보다 18% 늘었어요"),
  };
  const iconKey = set.addComponentProperty("Icon", "INSTANCE_SWAP", icons.Send.id);
  for (const v of set.children) {
    for (const k of Object.keys(keys)) textIn(v, k).componentPropertyReferences = { characters: keys[k] };
    iconIn(v).componentPropertyReferences = { mainComponent: iconKey };
  }
  return finishSet(set, "Metric Card", "대시보드 숫자 카드. 가장 중요한 지표 하나만 Accent(라임)로 강조해요.");
}

async function buildMessageBubble(parent) {
  const comps = [];
  for (const [dir, fill, text] of [["Incoming", "bg/subtle", "정보 부탁드려요!"], ["Outgoing", "bg/accent-soft", "안녕하세요! 요청하신 가을 신상품 링크를 보내드려요."]]) {
    const c = figma.createComponent();
    c.name = "Direction=" + dir;
    c.layoutMode = "HORIZONTAL";
    c.resize(264, 48);
    c.primaryAxisSizingMode = "FIXED";
    c.counterAxisSizingMode = "AUTO";
    bindPad(c, "space/12", "space/16");
    bindRadius(c, "radius/16");
    c.fills = [paint(fill)];
    const t = await txt(text, "Body", "text/primary", "Message");
    c.appendChild(t);
    t.layoutSizingHorizontal = "FILL";
    t.textAutoResize = "HEIGHT";
    comps.push(c);
  }
  const set = figma.combineAsVariants(comps, parent);
  gridVariants(set, ["Incoming", "Outgoing"], (p) => p.Direction);
  return finishSet(set, "Message Bubble", "DM 미리보기 말풍선 · 너비 264. Incoming은 고객 댓글, Outgoing은 링포가 보내는 DM. 문구는 글자 레이어를 직접 고쳐 써요.");
}

async function buildUsageMeter(parent) {
  const c = figma.createComponent();
  c.name = "Usage Meter";
  c.layoutMode = "VERTICAL";
  c.resize(200, 100);
  c.primaryAxisSizingMode = "AUTO";
  c.counterAxisSizingMode = "FIXED";
  bindPad(c, "space/16", "space/16");
  bindSpace(c, "itemSpacing", "space/8");
  bindRadius(c, "radius/12");
  c.fills = [paint("sidebar/hover")];
  const label = await txt("이번 달 발송", "Caption", "sidebar/text", "Label");
  const value = await txt("120 / 300", "Label", "text/inverse", "Value");
  c.appendChild(label);
  c.appendChild(value);
  const track = af("Track", "HORIZONTAL", { fill: "sidebar/bg" });
  track.resize(168, 4); // resize는 크기 모드를 FIXED로 되돌리므로 FILL보다 먼저
  c.appendChild(track);
  track.layoutSizingHorizontal = "FILL";
  track.layoutSizingVertical = "FIXED";
  bindRadius(track, "radius/full");
  const bar = figma.createRectangle();
  bar.name = "Fill";
  bar.resize(67, 4);
  bar.fills = [paint("sidebar/active")];
  bindRadius(bar, "radius/full");
  track.appendChild(bar);
  const caption = await txt("다음 갱신일 10월 1일", "Caption", "sidebar/text", "Caption");
  c.appendChild(caption);
  label.componentPropertyReferences = { characters: c.addComponentProperty("Label", "TEXT", "이번 달 발송") };
  value.componentPropertyReferences = { characters: c.addComponentProperty("Value", "TEXT", "120 / 300") };
  caption.componentPropertyReferences = { characters: c.addComponentProperty("Caption", "TEXT", "다음 갱신일 10월 1일") };
  c.description = "사이드바의 이번 달 DM 사용량. 막대(Fill) 너비로 비율을 보여요.";
  parent.appendChild(c);
  counts.components++;
  return c;
}

async function buildComponentsPage(page) {
  await figma.setCurrentPageAsync(page);
  const content = af("Components", "VERTICAL", { gap: 72 });
  const holder = (name) => af(name, "HORIZONTAL", { gap: 32, cross: "CENTER" });

  const brandHolder = holder("Brand holder");
  content.appendChild(await componentBlock("Brand", "Symbol · Logo(Ink/Lime/White) · App Icon(Ink/Lime) — 외주 시안의 말풍선 연결 심볼", brandHolder));
  const brand = await buildBrand(brandHolder);

  const iconRow = wrapGrid("Icon set", 1100, 16, 24);
  content.appendChild(await componentBlock("Icon", "24px 격자 · 선 1.75px · 둥근 끝. 버튼·칩·메뉴는 아이콘을 Icon 속성으로 교체해 써요.", iconRow));
  const icons = await buildIcons(iconRow);

  const blocks = [
    ["Button", "Style × Size(Medium 44/Small 36) × State 6가지. Label·Show icon·Icon 속성을 바꿔 써요.", (h) => buildButton(icons, h), "button"],
    ["Icon Button", "Ghost / Surface × Default · Hover · Focus · Disabled", (h) => buildIconButton(icons, h), "iconButton"],
    ["Badge", "Neutral · Success · Warning · Danger — 색과 문구를 함께", (h) => buildBadge(h), "badge"],
    ["Chip", "댓글 키워드. Label과 Removable 속성을 바꿔 써요.", (h) => buildChip(icons, h), "chip"],
    ["Toggle", "On / Off × Default · Focus · Disabled", (h) => buildToggle(h), "toggle"],
    ["Checkbox", "On / Off × Default · Disabled", (h) => buildCheckbox(icons, h), "checkbox"],
    ["Input", "Default · Hover · Focus · Filled · Error · Disabled", (h) => buildInput(icons, h), "input"],
    ["Nav Item", "데스크톱 사이드바 · Default · Hover · Active", (h) => buildNavItem(icons, h), "nav"],
    ["Tab Bar Item", "모바일 아래 탭 · Default · Active", (h) => buildTabItem(icons, h), "tab"],
    ["Metric Card", "대시보드 숫자 카드 · Default · Accent", (h) => buildMetricCard(icons, h), "metric"],
    ["Message Bubble", "DM 미리보기 · Incoming · Outgoing", (h) => buildMessageBubble(h), "bubble"],
    ["Usage Meter", "이번 달 DM 사용량 · 사이드바 하단", (h) => buildUsageMeter(h), "usage"],
  ];
  const out = { icons, symbol: brand.symbol, logo: brand.logo, app: brand.app };
  for (const [title, desc, build, key] of blocks) {
    const h = holder(title + " holder");
    content.appendChild(await componentBlock(title, desc, h));
    out[key] = await build(h);
  }

  const s = await section("Components", "링포 UI 컴포넌트 · 모든 색·간격·모서리가 변수에 연결돼 있어요.", content);
  stack([s]);
  return out;
}

// ---------------------------------------------------------------- 기초 문서
async function swatch(name, token, caption) {
  const cell = af(name, "VERTICAL", { gap: 8 });
  cell.resize(152, 10);
  cell.primaryAxisSizingMode = "AUTO";
  cell.counterAxisSizingMode = "FIXED";
  const chip = figma.createRectangle();
  chip.name = "Swatch";
  chip.resize(152, 88);
  chip.cornerRadius = 12;
  chip.fills = [paint(token)];
  chip.strokes = [paint("border/subtle")];
  chip.strokeWeight = 1;
  cell.appendChild(chip);
  cell.appendChild(await txt(name, "Label", "text/primary", "Name"));
  cell.appendChild(await txt(caption, "Caption", "text/secondary", "Value"));
  return cell;
}

function card(name, o) {
  o = o || {};
  const f = af(name, "VERTICAL", { gap: o.gap === undefined ? 16 : o.gap, pad: o.pad || [24, 24, 24, 24], fill: o.fill || "bg/surface", cross: o.cross });
  bindRadius(f, o.radius || "radius/16");
  if (!o.noStroke) stroke(f, "border/subtle", 1);
  return f;
}

async function buildFoundationsPage(page, c) {
  await figma.setCurrentPageAsync(page);

  // 표지
  const cover = af("Cover", "HORIZONTAL", { gap: 24 });
  const hero = card("Hero", { gap: 28, pad: [56, 56, 56, 56], fill: "bg/brand", radius: "radius/24", noStroke: true });
  cover.appendChild(hero);
  fixWidth(hero, 860);
  const logo = variant(c.logo, "Color=White").createInstance();
  logo.rescale(1.5);
  hero.appendChild(logo);
  hero.appendChild(await txt("댓글 하나로,\n연결은 계속.", "Heading/1", "text/inverse", "Tagline"));
  hero.appendChild(await txt("링포 · 댓글에 자동으로 답하고 DM으로 링크를 보내요", "Body", "sidebar/text", "Caption"));
  const iconCard = card("App Icon & Symbol", { gap: 20, pad: [40, 40, 40, 40], radius: "radius/24" });
  cover.appendChild(iconCard);
  fixWidth(iconCard, 460);
  const appRow = af("App Icons", "HORIZONTAL", { gap: 16 });
  appRow.appendChild(variant(c.app, "Style=Ink").createInstance());
  appRow.appendChild(variant(c.app, "Style=Lime").createInstance());
  iconCard.appendChild(await txt("APP ICON & SYMBOL", "Caption/Strong", "text/tertiary", "Eyebrow"));
  iconCard.appendChild(appRow);
  iconCard.appendChild(await txt("대화가 연결이 되는 순간", "Heading/3", "text/primary", "Title"));
  iconCard.appendChild(await txt("말풍선 두 개를 이어 만든 심볼.\n작은 파비콘에서도 알아보기 쉬운 형태.", "Body", "text/secondary", "Description"));
  const coverSection = await section("ringpo Design System v2", "BRAND & UI SYSTEM — 외주 시안 v1의 로고·토큰·컴포넌트를 합친 버전", cover);

  // 색
  const colors = af("Colors", "VERTICAL", { gap: 40 });
  const primGrid = wrapGrid("Primitives", 1360, 20, 32);
  for (const [name, hex] of PRIMITIVES) primGrid.appendChild(await swatch(name, name, hex));
  colors.appendChild(await componentBlock("Primitives", "원본 색. 디자인에는 아래 의미 토큰을 써요.", primGrid));
  const groups = {};
  for (const [name, ref] of SEMANTIC) {
    const g = name.split("/")[0];
    if (!groups[g]) groups[g] = [];
    groups[g].push([name, ref]);
  }
  for (const g of Object.keys(groups)) {
    const grid = wrapGrid(g, 1360, 20, 32);
    for (const [name, ref] of groups[g]) grid.appendChild(await swatch(name, name, "→ " + ref));
    colors.appendChild(await componentBlock("color/" + g, "", grid));
  }
  const colorSection = await section("Color", "차분한 Ink 네이비와 명확한 Lime 포인트 · 글자색은 모두 흰 바탕 대비 4.5:1 이상", colors);

  // 글자
  const typeList = af("Type scale", "VERTICAL", { gap: 28 });
  for (const t of TYPE) {
    const row = af(t.name, "HORIZONTAL", { gap: 40, cross: "CENTER" });
    const meta = af("Meta", "VERTICAL", { gap: 4 });
    meta.resize(280, 10);
    meta.primaryAxisSizingMode = "AUTO";
    meta.counterAxisSizingMode = "FIXED";
    meta.appendChild(await txt(t.name, "Label", "text/primary", "Name"));
    meta.appendChild(await txt(S[t.name].description, "Caption", "text/secondary", "Spec"));
    row.appendChild(meta);
    row.appendChild(await txt(t.name === "Metric" ? "1,248" : "댓글 하나로, 연결은 계속. Aa 0123456789", t.name, "text/primary", "Sample"));
    typeList.appendChild(row);
  }
  const typeSection = await section("Typography", "Pretendard · 32 / 24 / 20 / 16 / 14 / 12 · 숫자 36", typeList);

  // 간격·모서리·그림자
  const dims = af("Spacing, Radius & Shadow", "VERTICAL", { gap: 40 });
  const spacingList = af("Spacing", "VERTICAL", { gap: 12 });
  for (const value of SPACE) {
    const row = af("space/" + value, "HORIZONTAL", { gap: 16, cross: "CENTER" });
    const label = await txt("space/" + value, "Label", "text/primary", "Name");
    label.resize(160, label.height);
    label.textAutoResize = "HEIGHT";
    row.appendChild(label);
    const bar = figma.createRectangle();
    bar.name = "Bar";
    bar.resize(value, 24);
    bar.fills = [paint("bg/brand")];
    row.appendChild(bar);
    spacingList.appendChild(row);
  }
  dims.appendChild(await componentBlock("Spacing", "4px 단위 · 주로 8의 배수", spacingList));
  const radiusRow = af("Radius", "HORIZONTAL", { gap: 32 });
  for (const [name, value] of RADIUS) {
    const cell = af(name, "VERTICAL", { gap: 8, cross: "CENTER" });
    const sq = figma.createRectangle();
    sq.name = "Shape";
    sq.resize(88, 88);
    sq.fills = [paint("bg/subtle")];
    sq.strokes = [paint("border/default")];
    sq.strokeWeight = 1;
    bindRadius(sq, name);
    cell.appendChild(sq);
    cell.appendChild(await txt(name + " · " + (value === 999 ? "pill" : value), "Caption", "text/secondary", "Name"));
    radiusRow.appendChild(cell);
  }
  dims.appendChild(await componentBlock("Radius", "기본 모서리 12px · 카드 16 · 앱 아이콘 24", radiusRow));
  const shadowRow = af("Shadows", "HORIZONTAL", { gap: 32, pad: [8, 8, 24, 8] });
  for (const [name] of SHADOWS) {
    const box = card(name, { gap: 4, noStroke: true });
    fixWidth(box, 200);
    await box.setEffectStyleIdAsync(E[name].id);
    box.appendChild(await txt(name, "Label", "text/primary", "Name"));
    box.appendChild(await txt(E[name].description, "Caption", "text/secondary", "Spec"));
    shadowRow.appendChild(box);
  }
  dims.appendChild(await componentBlock("Shadow", "기본은 평평하게. 떠 있는 요소(토글 손잡이·팝오버)에만 그림자", shadowRow));
  const dimSection = await section("Spacing, Radius & Shadow", "4px 간격 · 12px 모서리 · 옅은 Ink 그림자", dims);

  stack([coverSection, colorSection, typeSection, dimSection]);
  return coverSection;
}

// ---------------------------------------------------------------- 예시 화면
async function setText(node, name, chars) {
  const t = textIn(node, name);
  if (!t) throw new Error(node.name + "에 " + name + " 글자가 없어요");
  t.characters = chars;
}

async function buildExamplesPage(page, c) {
  await figma.setCurrentPageAsync(page);
  const screen = af("Dashboard · Desktop 1440", "HORIZONTAL", { fill: "bg/canvas" });
  screen.resize(1440, 1000);
  screen.primaryAxisSizingMode = "FIXED";
  screen.counterAxisSizingMode = "FIXED";
  screen.clipsContent = true;

  // 사이드바: 링포 실제 메뉴(홈·자동화·결제·설정)
  const side = af("Sidebar", "VERTICAL", { gap: 8, pad: [28, 20, 24, 20], fill: "sidebar/bg" });
  screen.appendChild(side);
  fixWidth(side, 240);
  side.layoutSizingVertical = "FILL";
  const logoWrap = af("Logo", "VERTICAL", { pad: [0, 0, 28, 0] });
  const logo = variant(c.logo, "Color=White").createInstance();
  logo.rescale(0.6);
  logoWrap.appendChild(logo);
  side.appendChild(logoWrap);
  const menu = [["홈", "Home", true], ["자동화", "Automation", false], ["결제", "Billing", false], ["설정", "Settings", false]];
  for (const [label, icon, active] of menu) {
    const item = variant(c.nav, active ? "State=Active" : "State=Default").createInstance();
    item.setProperties(props(c.nav, { Label: label, Icon: c.icons[icon].id }));
    side.appendChild(item);
  }
  const spacer = af("Spacer", "VERTICAL");
  side.appendChild(spacer);
  spacer.layoutSizingVertical = "FILL";
  const usage = c.usage.createInstance();
  side.appendChild(usage);
  usage.layoutSizingHorizontal = "FILL";

  // 본문
  const main = af("Main", "VERTICAL", { gap: 24, pad: [32, 40, 32, 40] });
  screen.appendChild(main);
  main.layoutSizingHorizontal = "FILL";
  main.layoutSizingVertical = "FILL";

  const header = af("Header", "HORIZONTAL", { gap: 12, cross: "CENTER" });
  main.appendChild(header);
  header.layoutSizingHorizontal = "FILL";
  const titles = af("Titles", "VERTICAL", { gap: 4 });
  titles.appendChild(await txt("홈", "Heading/1", "text/primary", "Title"));
  titles.appendChild(await txt("오늘도 댓글에 자동으로 답하고 있어요.", "Body", "text/secondary", "Subtitle"));
  header.appendChild(titles);
  titles.layoutSizingHorizontal = "FILL";
  const connected = variant(c.badge, "Tone=Success").createInstance();
  await setText(connected, "Label", "@ringpo.shop 연결됨");
  header.appendChild(connected);
  header.appendChild(variant(c.iconButton, "Style=Ghost, State=Default").createInstance());
  header.appendChild(variant(c.button, "Style=Primary, Size=Medium, State=Default").createInstance());

  const metrics = af("Metrics", "HORIZONTAL", { gap: 16 });
  main.appendChild(metrics);
  metrics.layoutSizingHorizontal = "FILL";
  const M = [
    ["Accent", "보낸 DM", "1,248", "지난주보다 18% 늘었어요", "Send"],
    ["Default", "링크 클릭", "312", "클릭률 25.0%", "Link"],
    ["Default", "대기 중인 댓글", "3", "곧 차례대로 보내요", "Clock"],
    ["Default", "실행 중인 자동화", "4", "모두 정상 작동 중이에요", "Automation"],
  ];
  for (const [style, label, value, caption, icon] of M) {
    const m = variant(c.metric, "Style=" + style).createInstance();
    m.setProperties(props(c.metric, { Label: label, Value: value, Caption: caption, Icon: c.icons[icon].id }));
    metrics.appendChild(m);
    m.layoutSizingHorizontal = "FILL";
  }

  const bottom = af("Bottom", "HORIZONTAL", { gap: 16 });
  main.appendChild(bottom);
  bottom.layoutSizingHorizontal = "FILL";

  const list = card("Recent automations");
  bottom.appendChild(list);
  list.layoutSizingHorizontal = "FILL";
  const listHead = af("Head", "HORIZONTAL", { cross: "CENTER" });
  list.appendChild(listHead);
  listHead.layoutSizingHorizontal = "FILL";
  const listTitle = await txt("최근 자동화", "Heading/3", "text/primary", "Title");
  listHead.appendChild(listTitle);
  listTitle.layoutSizingHorizontal = "FILL";
  const all = variant(c.button, "Style=Secondary, Size=Small, State=Default").createInstance();
  all.setProperties(props(c.button, { Label: "전체 보기", "Show icon": false }));
  listHead.appendChild(all);
  const rows = [
    ["가을 신상품 안내", "키워드 · 정보, 링크", "Success", "실행 중", "846건", "24.8%"],
    ["무료 가이드 보내기", "키워드 · 가이드", "Success", "실행 중", "402건", "26.4%"],
    ["주말 이벤트", "모든 댓글", "Warning", "일시 정지", "128건", "18.2%"],
    ["라이브 공지", "키워드 · 알림", "Danger", "확인 필요", "—", "—"],
  ];
  for (const [name, keywords, tone, status, sent, rate] of rows) {
    const row = af(name, "HORIZONTAL", { gap: 16, cross: "CENTER", pad: [12, 0, 12, 0] });
    list.appendChild(row);
    row.layoutSizingHorizontal = "FILL";
    const who = af("Name", "VERTICAL", { gap: 2 });
    who.appendChild(await txt(name, "Label", "text/primary", "Name"));
    who.appendChild(await txt(keywords, "Caption", "text/tertiary", "Keywords"));
    row.appendChild(who);
    who.layoutSizingHorizontal = "FILL";
    const badge = variant(c.badge, "Tone=" + tone).createInstance();
    await setText(badge, "Label", status);
    row.appendChild(badge);
    for (const [v, w] of [[sent, 72], [rate, 64]]) {
      const t = await txt(v, "Body", "text/primary", "Value");
      row.appendChild(t);
      t.resize(w, t.height);
      t.textAutoResize = "HEIGHT";
    }
    const more = variant(c.iconButton, "Style=Ghost, State=Default").createInstance();
    more.setProperties(props(c.iconButton, { Icon: c.icons.More.id }));
    row.appendChild(more);
  }

  const preview = card("DM preview");
  bottom.appendChild(preview);
  fixWidth(preview, 360);
  const pHead = af("Head", "HORIZONTAL", { cross: "CENTER" });
  preview.appendChild(pHead);
  pHead.layoutSizingHorizontal = "FILL";
  const pTitle = await txt("DM 미리보기", "Heading/3", "text/primary", "Title");
  pHead.appendChild(pTitle);
  pTitle.layoutSizingHorizontal = "FILL";
  const msgIcon = c.icons.Message.createInstance();
  msgIcon.resize(20, 20);
  pHead.appendChild(msgIcon);
  const account = af("Account", "HORIZONTAL", { gap: 12, cross: "CENTER" });
  const avatar = af("Avatar", "HORIZONTAL", { main: "CENTER", cross: "CENTER", fill: "bg/accent-soft" });
  avatar.resize(32, 32);
  avatar.primaryAxisSizingMode = "FIXED";
  avatar.counterAxisSizingMode = "FIXED";
  bindRadius(avatar, "radius/full");
  avatar.appendChild(await txt("RP", "Caption/Strong", "text/primary", "Initials"));
  account.appendChild(avatar);
  const accName = af("Name", "VERTICAL");
  accName.appendChild(await txt("ringpo.shop", "Label", "text/primary", "Handle"));
  accName.appendChild(await txt("자동 응답 메시지", "Caption", "text/tertiary", "Caption"));
  account.appendChild(accName);
  preview.appendChild(account);
  preview.appendChild(await txt("고객 댓글", "Caption", "text/tertiary", "Comment label"));
  preview.appendChild(variant(c.bubble, "Direction=Incoming").createInstance());
  preview.appendChild(await txt("링포가 보낸 DM", "Caption", "text/tertiary", "DM label"));
  preview.appendChild(variant(c.bubble, "Direction=Outgoing").createInstance());
  const linkBtn = variant(c.button, "Style=Secondary, Size=Medium, State=Default").createInstance();
  linkBtn.setProperties(props(c.button, { Label: "상품 보러 가기", Icon: c.icons.External.id }));
  preview.appendChild(linkBtn);
  preview.appendChild(await txt("샘플 메시지 · 실제 발송 전에 확인하세요.", "Caption", "text/tertiary", "Note"));

  const s = await section("Examples", "외주 시안의 대시보드 구성을 링포 실제 메뉴·지표로 옮긴 예시 · 모두 컴포넌트 인스턴스", screen);
  stack([s]);
}

// ---------------------------------------------------------------- 페이지
async function ensurePages() {
  const roots = figma.root.children;
  if (!roots.find((p) => p.name === "Foundations") && roots[0].name === "Page 1") roots[0].name = "Foundations";
  const pages = {};
  for (const name of ["Foundations", "Components", "Examples"]) {
    let p = figma.root.children.find((x) => x.name === name);
    if (!p) {
      try {
        p = figma.createPage();
        p.name = name;
      } catch (e) {
        p = figma.root.children[0];
        notes.push("페이지를 더 만들 수 없어 '" + name + "' 내용을 " + p.name + "에 넣었어요");
      }
    }
    pages[name] = p;
  }
  return pages;
}

async function clearGenerated(pages) {
  const seen = new Set();
  for (const name of Object.keys(pages)) {
    const p = pages[name];
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    await figma.setCurrentPageAsync(p);
    for (const n of p.children.slice()) if (n.getPluginData(MARK) === "1") n.remove();
  }
}

// ---------------------------------------------------------------- 실행
async function main() {
  figma.notify("1/6 글꼴 확인 중…");
  const fonts = await resolveFonts();
  figma.notify("2/6 이전 결과 정리 중…");
  const pages = await ensurePages();
  await clearGenerated(pages);
  await removeLegacy();
  figma.notify("3/6 변수와 스타일 만드는 중…");
  await buildVariables();
  await buildTextStyles(fonts);
  await buildEffectStyles();
  figma.notify("4/6 컴포넌트 만드는 중…");
  const comps = await buildComponentsPage(pages.Components);
  figma.notify("5/6 예시 화면 만드는 중…");
  await buildExamplesPage(pages.Examples, comps);
  figma.notify("6/6 기초 문서 만드는 중…");
  const cover = await buildFoundationsPage(pages.Foundations, comps);
  figma.viewport.scrollAndZoomIntoView([cover]);
  const summary =
    "✅ 링포 디자인 시스템 v2 완료 · 변수 " + counts.variables + "개 · 스타일 " + counts.styles + "개 · 컴포넌트 " + counts.components + "개" +
    (notes.length ? " · " + notes.join(" · ") : "");
  figma.closePlugin(summary);
}

main().catch((e) => {
  console.error(e);
  figma.closePlugin("❌ 생성 실패: " + (e && e.message ? e.message : String(e)));
});
