# 링포 브랜드 이미지 묶음

디자인 A "블록 팝"(2026-10-23) 색으로 다시 만들었어요. 핑크 `#D61F5C` · 잉크 `#1B1220` · 노랑 `#FFD43B`.
심볼과 워드마크는 그대로이고(앱의 `src/components/brand/logo.tsx` 와 같은 패스), 색만 바뀌었어요. 이전 잉크 + 라임 묶음은 git 기록에 있어요.
앱 아이콘은 모두 정사각형(모서리 없음)이에요. 모서리는 각 플랫폼이 알아서 둥글게 깎아요.

**새 색으로 바꾸려면 각 플랫폼에 다시 올려야 해요** — 사이트(`src/app/`)에는 이미 적용됐어요.

| 파일 | 크기 | 어디에 쓰나 |
|---|---|---|
| `meta-app-icon-1024.png` | 1024×1024 | Meta 개발자 → 앱 설정 → 기본 설정 → 앱 아이콘 |
| `kakao-app-icon-128.png` | 128×128 | 카카오 디벨로퍼스 → 앱 → 일반 → 앱 기본 정보 → 앱 아이콘 (250KB 미만, 128 이하 권장) |
| `profile-1080.png` / `profile-640.png` | 1080 / 640 | 링포 공식 인스타·카카오톡 채널 프로필 사진. 원형으로 잘려도 심볼이 안 잘리게 여백을 뒀어요 |
| `og-image-1200x630.png` | 1200×630 | 링크 공유 미리보기. 사이트에 적용됨(`src/app/opengraph-image.png` · `twitter-image.png`) |
| `favicon.ico`, `svg/favicon.svg`, `apple-touch-icon-180.png` | 16~48 / 벡터 / 180 | 브라우저 탭 아이콘, 아이폰 홈 화면. 사이트에 적용됨 |
| `app-icon-512.png`, `app-icon-256.png`, `app-icon-192.png` | | 그 밖에 앱 아이콘을 요구하는 곳(포트원 상점 로고, 구글 OAuth 동의 화면 등) |
| `app-icon-yellow-1024.png` | 1024×1024 | 노랑 바탕 + 잉크 심볼(보조) |
| `logo-ink-1032w.png` | 1032×280, 투명 | 밝은 바탕용 기본 로고 — 핑크 심볼 + 잉크 글자(사이트 머리글과 같다) |
| `logo-white-1032w.png` | 1032×280, 투명 | 어두운·핑크 바탕용 |
| `logo-pink-1032w.png` | 1032×280, 투명 | 밝은 바탕에서 한 색으로 쓸 때 |
| `svg/*.svg` | 벡터 | 원본. 크기를 바꿔야 할 때 이걸 써요 |

다시 만들기: `generate.mjs`(헤드리스 크롬으로 SVG 를 찍는다). 링포에는 Playwright 가 없어서 설치된 곳을 알려 줘야 해요 —
`PLAYWRIGHT_FROM=<playwright 가 있는 package.json> node docs/design/brand-assets/generate.mjs`. 공유 이미지는 이 스크립트가 아니라 사이트 것을 복사해 둔 거예요.
