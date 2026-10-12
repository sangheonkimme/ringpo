# 링포 디자인 시스템 빌더 (Figma 개발용 플러그인)

Figma 파일에 링포 디자인 시스템을 한 번에 만든다. 두 가지 자료를 기준으로 한다.

- 브랜드 보드(ringpo BRAND & UI SYSTEM / 01)
- 외주 디자이너 시안 v1(`docs/design/external-v1/`)

v2에서 시안의 로고, 토큰 이름, 상태, 컴포넌트를 합쳤다.

## 만드는 것

### 변수 78개 (컬렉션 3개)

- **`Primitives`:** 원본 색 22개. 선택 목록에서는 숨긴다.
- **`Color`:** 의미 색 40개(Light).
  - 시안 토큰 37개에 `icon/disabled`, `control/off`, `border/hover`를 더했다.
- **`Layout`:** 간격 `space/4…64` 10개와 모서리 `radius/4…24, full` 6개.
- **코드 이름:** 시안의 `tokens/ringpo.css`와 같게 맞췄다(`var(--color-bg-canvas)`, `var(--space-16)`, `var(--primitive-ink-900)`).

### 스타일 11개

- **텍스트 9개**
  - Heading/1·2·3
  - Body/Large
  - Body
  - Label
  - Caption
  - Caption/Strong
  - Metric
- **그림자 2개:** Shadow/Small, Shadow/Medium
- **글꼴:** Pretendard를 쓰고, 없으면 Noto Sans KR로 대체한다.

### 페이지 3개

- **Foundations:** 표지(실제 로고), 색, 글자, 간격·모서리·그림자
- **Components**
- **Examples:** 데스크톱 대시보드. 실제 메뉴(홈·자동화·결제·설정)와 실제 지표를 쓴다.

### 컴포넌트

**브랜드**
- Symbol
- Logo: Ink / Lime / White
- App Icon: Ink / Lime

**아이콘 22개**
- Lucide 기반, 선 1.75px
- 앱 코드의 `lucide-react`와 모양이 같다.

**버튼**
- **Button**
  - Primary/Secondary × Medium 44/Small 36 × 6가지 상태
  - 상태: Default, Hover, Pressed, Focus, Disabled, Loading
  - 비활성 상태에서는 아이콘을 숨긴다.
- **Icon Button:** Ghost/Surface × 4가지 상태

**상태·선택**
- **Badge:** Neutral / Success / Warning / Danger
- **Chip:** 높이 40, 지울 수 있음
- **Toggle:** On/Off × Default/Focus/Disabled. 프로토타입에서 클릭하면 전환된다.
- **Checkbox:** On/Off × Default/Disabled. 프로토타입에서 클릭하면 전환된다.

**입력**
- **Input:** 6가지 상태
- 입력 글자는 16px이다. iOS Safari는 16px 미만 입력창을 누르면 화면을 확대하기 때문이다.

**메뉴**
- **Nav Item:** 데스크톱 사이드바
- **Tab Bar Item:** 모바일 아래 탭

**대시보드**
- Metric Card
- Message Bubble
- Usage Meter

**공통:** 모든 색·간격·모서리는 변수에 연결돼 있다.

## 실행 방법

1. Pretendard를 설치하고(`brew install --cask font-pretendard`) Figma 데스크톱 앱을 재시작한다.
2. Figma 데스크톱 앱에서 디자인 시스템 파일을 연다.
3. 메뉴 → Plugins → Development → **Import plugin from manifest…** → 이 폴더의 `manifest.json`을 선택한다.
   - 이미 가져왔다면 이 단계는 건너뛴다. `code.js`만 바뀌었다.
4. 메뉴 → Plugins → Development → **Ringpo Design System Builder**를 실행한다.
5. 완료 알림에서 확인한다.
   - 변수·스타일·컴포넌트 개수
   - 대체 글꼴을 썼는지
   - v1에서 정리한 변수 수

## 다시 실행할 때

- **변수와 스타일:** 이름으로 찾아 값만 갱신한다. 이미 연결된 곳은 유지된다.
- **v1 이름 정리:** v1 이름(`lime/400`, `spacing/md`, `Body/16 Regular` 등)은 지운다.
  - `Spacing` 컬렉션은 `Layout`으로 이름을 바꾼다.
- **생성한 섹션:** 이 플러그인이 만든 섹션(pluginData `ringpo-ds`)만 지우고 다시 만든다. 직접 만든 레이어는 건드리지 않는다.
- **주의:** 컴포넌트도 새로 만들어진다. 그래서 다른 파일에서 이미 쓰고 있는 인스턴스와의 연결이 끊긴다. 라이브러리로 배포한 뒤에는 다시 실행하지 말고 Figma에서 직접 수정한다.
