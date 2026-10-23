# 링포 UI 기준표

## 0. 디자인 A "블록 팝" (2026-10-23 — 이 절이 아래 표보다 우선)

사용자 결정으로 전면 리디자인했다. 시안 3개(A 블록 팝 · B 에디토리얼 · C 다크 콘솔) 중 A를 골랐고, 앱 홈의 최근 발송은 C의 시간순 로그를 가져왔다.
시안은 claude.ai 캔버스 "링포 리디자인 시안"(https://claude.ai/artifact/FMPXhqsEuhRUbsoKTQLq2w, 비공개)에 있다. 이 폴더의 `*.dc.html` 과 `external-v1` 은 **이전(잉크 네이비 + 라임) 디자인**이다.

**아래 1~7절의 글자 크기·간격·버튼 높이 원칙은 그대로 쓴다. 색·모서리·버튼 색·카드 모양은 이 절을 따른다.**

| 역할 | 값 | 토큰 / Tailwind |
|---|---|---|
| 글자·어두운 면(잉크) | `#1B1220` | `foreground` · `bg-foreground` |
| 누르는 것(핑크) — 주 버튼, 지금 메뉴, 토글 켜짐 | `#D61F5C` (흰 글자 5:1) | `primary` · `pop` · 흰 바탕 위 핑크 글자는 `text-brand-ink` |
| 강조(노랑) — 형광펜, 키워드 칩, 추천 배지 | `#FFD43B` (글자는 잉크) | `brand` · 노랑 위 작은 글자는 `text-yellow-ink` |
| 보조 면(연보라) | `#EAE4FF` | `lilac` · 글자 `lilac-ink` |
| 연분홍 면 | `#FFE1EA` | `pop-soft` · 글자 `pop-ink` |
| 바탕 / 카드 | `#FAF7FB` / `#FFFFFF` | `background` / `card` (마케팅 페이지 바탕은 흰색) |
| 입력칸 테두리 | `#9C8EA3` (흰 바탕 3:1) | `input` |

- **글꼴**: 제목·큰 숫자는 Black Han Sans(`font-display`, Google Fonts), 본문은 Pretendard. Black Han Sans 는 굵기가 하나라 `font-extrabold` 를 붙여도 굵어지지 않는다(가짜 볼드를 껐다).
- **모서리**: 한 단계씩 키웠다 — `rounded-xl` 16 · `2xl` 22 · `3xl` 28. 큰 카드는 `rounded-3xl`.
- **버튼**: 주 행동(다음·저장·결제·연결·무료로 시작)은 **핑크 채움 + 아래로 떨어지는 잉크 그림자** `bg-primary text-primary-foreground shadow-[0_4px_0_var(--foreground)]`(랜딩은 6px), 누르면 `active:translate-y-0.5`.
  제목 옆 작은 행동(새 자동화)은 잉크 채움, 보조는 2px 잉크 테두리.
- **카드**: 강조 카드(켜진 자동화, 선택한 항목, 요금 Free)는 `border-2 border-foreground` + 그림자. 보통 카드는 흰 면 + 옅은 테두리. 요약 숫자 카드는 색 블록(이번 달 DM 핑크, 발송 대기 노랑, 계정 연보라).
- **아래 메뉴**: 화면 아래 12px 떠 있는 잉크 바, 지금 메뉴는 핑크 알약.
- **발송 기록**: 시간순 로그 — 왼쪽 칸에 한국 시각(오늘이 아니면 날짜를 위에, `lib/time.ts` 의 `logTime`), 가운데 댓글과 사유, 오른쪽 결과 배지.
- **사이트 아이콘·공유 이미지**: 핑크 타일 + 흰 심볼, 공유 이미지는 흰 바탕 + 노랑 형광펜 + 핑크 블록(`src/app/icon.svg` · `apple-icon.png` · `favicon.ico` · `opengraph-image.png` · `twitter-image.png`).
  `brand-assets/` 의 Meta·카카오 등록용 아이콘·프로필·로고도 새 색으로 다시 만들었다(`generate.mjs`). **플랫폼에 올리는 것은 사람 몫이다** — 올리기 전까지 Meta·카카오에는 이전 아이콘이 보인다.
- **운영 반영** (2026-10-23 11:15 KST, `0af37b8`, 사용자 지시): 커밋을 깨끗한 폴더로 꺼내 `ringpo:0af37b8` 를 빌드하고 **web 만** 교체했다(`docker compose up -d web`, migrate 는 새 마이그레이션 없이 0 으로 끝남).
  worker 는 `ringpo:fc3347e` 그대로 둔다 — 서버 코드는 같고, 활성 공구 발송을 끊지 않으려고. 교체 직전 운영은 최근 24시간 댓글 0 · 공구 0 · 발송 대기 0. 교체 뒤 strict health 정상(약 8초), 운영 주소에서 랜딩·로그인 화면을 헤드리스로 확인했다.
  되돌리기: `deploy/.env` 의 `IMAGE=ringpo:fc3347e` 로 바꾸고 `docker compose up -d web`.
  같은 날 `feat/gonggu-operations` 에 빨리감기로 합쳐 푸시했다(사용자 지시) — 이제 그 브랜치로 배포해도 디자인이 유지된다.

---

화면끼리 같은 역할이면 같은 값을 쓴다. 외주 디자이너 토큰(`docs/design/external-v1/tokens`)의 원칙을 따른다. 4px 간격, 기본 모서리 12px, 옅은 잉크 그림자, 평평하게. 토큰에 없는 값은 앱이 실제로 쓰던 값 중 가장 많이 쓴 것으로 정했다(2026-09-28 결정).

정한 것
- 글자 크기는 앱이 쓰던 체계(28/18/16/15/14/13/12)를 정리해서 쓴다. 디자이너의 32/24/20/16/14/12는 데스크톱 기준이라 따르지 않는다.
- 큰 버튼은 54px.
- DM 미리보기의 버튼은 실제 인스타그램 앱 모양을 따른다(아래 7번).

## 1. 글자

| 역할 | 값 | Tailwind |
|---|---|---|
| 페이지 제목 (앱) | 28 / 800 / 행간 1.3 | `text-[28px] font-extrabold leading-[1.3]` (자간은 기존 값 유지) |
| 위자드 단계 제목 | 24 / 800 / 행간 1.35 | 위자드 화면 안의 질문형 제목 (페이지 제목과 다른 역할) |
| 섹션 제목 | 18 / 700 | `text-lg font-bold` |
| 카드 제목 | 16 / 700 | `text-base font-bold` |
| 필드 라벨 | 14 / 600 | `text-sm font-semibold` |
| 본문 여러 줄 | 14 / 행간 1.7 | `text-sm leading-[1.7]` |
| 본문 한 줄 | 14 / 20px | `text-sm` |
| 보조 설명 | 13 / 행간 1.5 | `text-[13px] leading-normal` |
| 캡션·배지 | 12 / 600 | `text-xs font-semibold` |
| 입력 글자 | 16 | `text-base` (iOS 확대 방지) |
| 확인 창 제목 | 16 / 700 | `text-base font-bold` |
| 랜딩 | h1 44·84, h2 30·48. 하단 CTA 제목 56만 강조용 예외 | 기존 값 |

`leading-relaxed`(1.625)와 1.65는 쓰지 않는다. 여러 줄 14px 본문은 1.7, 13px 설명은 1.5.

## 2. 버튼

| 크기 | 높이 / 모서리 / 글자 | Tailwind | 쓰는 곳 |
|---|---|---|---|
| L | 54 / 12 / 16·600 | `h-[54px] rounded-xl text-base font-semibold` | 화면의 주요 행동: 위자드 하단 바, 로그인, 온보딩, 결제 폼, 랜딩 모바일 버튼, 랜딩 요금 카드 |
| M | 48 / 12 / 15·600 | `h-12 rounded-xl text-[15px] font-semibold` | 카드·확인 창 안의 행동: 수정, 삭제, 시작하기, 업그레이드, 설정의 계정 연결, 더 보기, 확인 창 버튼 |
| S | 44 / 12 / 15·600 | `h-11 rounded-xl text-[15px] font-semibold` | 제목 옆·목록 위 작은 행동: 새 자동화, 첫 자동화 만들기, 구독 해지, 다시 연결, 연결 해제, 문구 추가 |
| 랜딩 CTA (데스크톱) | 58 / 16 / 17·600 | `md:h-[58px] md:rounded-2xl md:text-[17px]` | 히어로, 하단 CTA |
| 입력창 옆 버튼 | 52 / 12 | `h-[52px] rounded-xl` | 키워드 "추가" (입력창 높이에 맞춤) |

모양
- 주: 잉크 채움 `bg-foreground text-white`
- 보조: 1.5px 잉크 테두리 `border-[1.5px] border-foreground`
- 약한 보조: 1px 입력 테두리 `border border-input bg-card`
- 추가형: 1px 점선
- 위험(페이지): 빨간 글자 `text-destructive`
- 위험(확인 창): 빨간 채움 + 흰 글자 `bg-destructive text-white`
- 글자 버튼 좌우 여백 20 (`px-5`)

## 3. 입력창

높이 52 / 모서리 12 / 좌우 16 / 16px / 1px `#D3DBE5` / 안내 글자 `#6B7280` / 포커스 2px `#4168DA`
`h-[52px] rounded-xl border border-input bg-card px-4 text-base placeholder:text-muted-foreground`
여러 줄 입력칸: 위아래 14, 좌우 16 (`px-4 py-3.5`), 모서리 12.

## 4. 카드·모서리·그림자

| 요소 | 모서리 / 안쪽 여백 | Tailwind |
|---|---|---|
| 큰 카드 (설정, 플랜, 온보딩 단계, 메시지 미리보기 틀) | 16 / 20 | `rounded-2xl p-5` |
| 목록 카드 (행 반복) | 16 / 행마다 위아래 14·좌우 16 | `rounded-2xl` + 행 `px-4 py-3.5` (오른쪽에 토글이 있으면 `pr-3`) |
| 작은 타일 (통계 칸, 선택지 카드, 토글 설정 카드) | 12 / 16 | `rounded-xl p-4` |
| 칩·배지 | 999 | `rounded-full` |
| 랜딩 카드 | 모바일 16 / 데스크톱 24 | `rounded-2xl md:rounded-3xl` |
| 선택 체크 원 | 24 | `size-6` |
| 그림자 | 평소 없음. 떠 있는 요소만 | Small `shadow-[0_1px_2px_rgba(20,35,56,0.06)]`, Medium `shadow-[0_8px_24px_rgba(20,35,56,0.1)]` |

## 5. 간격

| 규칙 | 값 | Tailwind |
|---|---|---|
| 화면 좌우 | 20 | `px-5` |
| 헤더 아래 첫 요소 | 20 | `pt-5` |
| 페이지의 큰 덩어리 사이 | 20 | `gap-5` |
| 섹션 제목 → 내용 | 12 | `gap-3` |
| 라벨 → 입력창 | 8 | `gap-2` |
| 같은 묶음의 카드 사이 | 12 | `gap-3` |
| 회색 안내 상자 | 위아래 14 | `py-3.5` |
| 랜딩 섹션 위아래 (히어로 제외) | 데스크톱 112 / 모바일 56 | `py-14 md:py-28` |

## 6. 표시 방식

- 상태 표시는 모두 `ToneBadge`(점 있는 알약). 연결됨 success, 다시 연결 필요 danger, 결제 내역 상태도 같은 배지.
- 빈 상태는 하나: 1px 점선 `border-input`, 모서리 16, 여백 24, 배경 없음, 가운데 정렬, 14px `#526075`, 필요하면 S 버튼.
- 프로필 사진 자리: 테두리 없음, 빈 값 `#F3FBDF`.
- 랜딩 헤더 메뉴 hover: `#526075` (`hover:text-ink-2`).
- 색은 hex 대신 토큰(`border-input`, `bg-border`, `bg-background`, `bg-sidebar-accent`, `text-ink-700` 등).

## 7. DM 미리보기 (실제 인스타그램 앱 모양)

인스타 앱의 버튼 템플릿은 **말풍선 안에 버튼이 폭 전체로 들어간다**. 버튼은 테두리가 없고 말풍선과 살짝 다른 배경색이다(다크 모드 캡처 기준, 라이트 모드로 옮김).

- 말풍선: 배경 `#F0F3F6`(bubble), 모서리 20, 안쪽 여백 16, 본문 15px / 행간 1.6, 줄바꿈 유지
- 말풍선 안 버튼: 폭 전체, 높이 44, 모서리 12, 배경 흰색, 글자 15 / 600 잉크, 가운데, 테두리 없음, 본문과 간격 12
- 팔로우 확인 말풍선도 같은 모양, 버튼 "팔로우했어요"
- DM 단계와 확인 단계가 **같은 컴포넌트**를 쓴다
- 말풍선 모서리 20은 인스타 모양을 재현하려는 유일한 예외다
