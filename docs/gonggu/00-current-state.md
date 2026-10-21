# 공구 캠페인: 현재 구현 조사

작성일: 2026-10-21 (UTC)  
기준: `feat/mvp`, `dbec90ce1491ab034ef692e6b2d0bd5354ebafa6`  
범위: 저장소 코드·마이그레이션·테스트·배포 정의 및 Meta 공식 문서. 운영 DB 내용, 실제 토큰, Meta 앱 대시보드는 조회하지 않았다. 앱 심사 통과는 작업 지시의 전제로 받아들이며, 저장소의 심사 준비 문서만으로 승인 상태를 재판정하지 않는다.

이 문서는 조사 결과다. 캠페인 구현은 [설계 문서](01-design.md) 리뷰 승인 후 시작한다.

## 1. 기술 스택과 관례

| 영역 | 확인 내용 | 근거 |
| --- | --- | --- |
| 웹 | Next.js 16.3.6 App Router, React 19.2.8, TypeScript 5.9.3 | [package.json](../../package.json), `src/app` |
| 실행·빌드 | pnpm 10.28.1, CI Node 24, worker는 tsx 개발/esbuild 번들 | [빌드 스크립트](../../scripts/build-worker.mjs), [CI](../../.github/workflows/ci.yml) |
| UI | Tailwind 4, Radix/shadcn 계열, Server Components/Server Actions | `src/components/app`, `src/app/app` |
| DB | PostgreSQL 17, Drizzle ORM 0.45.3, postgres.js. 스키마는 단일 TS 파일 | [schema.ts](../../src/server/db/schema.ts), [client.ts](../../src/server/db/client.ts) |
| 인증 | Better Auth, Google/Kakao OAuth, 이메일 magic link | [auth.ts](../../src/server/auth.ts) |
| 결제·알림 | PortOne V2, Resend | `src/server/billing`, [notifications.ts](../../src/server/notifications.ts) |
| 배포 | VPS의 Docker Compose: PostgreSQL/web/worker/migrate/backup, Traefik, GHCR | [Compose](../../deploy/docker-compose.yml), [배포 CI](../../.github/workflows/deploy.yml) |
| 시간 | DB `timestamptz`, TS `Date`; 기존 화면은 KST 보조 함수 사용 | [time.ts](../../src/lib/time.ts) |

Vercel 배포나 Redis/BullMQ는 현재 구조에 없다. 기존 PostgreSQL worker를 확장한다. SQL 테이블은 snake_case, TS export는 camelCase, UUID PK, `text` 상태 + TS enum 관례다. 서비스 함수는 DB와 Graph client·시계·random을 주입받아 테스트한다.

[AGENTS.md](../../AGENTS.md)는 Next.js 코드 작성 전 설치된 버전의 `node_modules/next/dist/docs/` 관련 문서를 읽도록 요구한다. 이번 변경은 문서 두 개이며 코드 작성은 하지 않는다.

## 2. 웹훅과 기존 처리 순서

1. [Instagram route](../../src/app/api/webhooks/instagram/route.ts)의 GET은 challenge 검증, POST는 raw body의 `x-hub-signature-256`을 HMAC으로 검증한다. Instagram/Meta 앱 시크릿 둘을 지원한다.
2. [webhook.ts](../../src/server/instagram/webhook.ts)는 `comments`를 파싱하고 큰 숫자 ID를 문자열로 보존한다. 댓글 ID·미디어·작성자 IGSID·username·본문·부모 댓글을 추출한다. **댓글 작성 시각과 webhook entry time은 저장하지 않는다.**
3. [ingest.ts](../../src/server/queue/ingest.ts)는 활성 IG 계정 중 **활성 기존 automation이 있는 계정만** 수집한다. 캠페인만 있는 계정은 현재 조건에서 누락된다. 본인 ID 댓글은 미리 제외한다.
4. [events.ts](../../src/server/queue/events.ts)는 `comment_events.comment_id UNIQUE`와 `ON CONFLICT DO NOTHING`으로 중복 삽입을 막고 `pg_notify`로 worker를 깨운다.
5. worker가 이벤트를 claim → 계정·만료·본인 댓글 검증 → 기존 규칙 선택 → 사람 기준 발송 예약 → 월 사용량 예약 → 계정 발송 슬롯 예약 → 공개 답글 → private reply → 결과 기록 순으로 처리한다. [process-comment.ts](../../src/server/pipeline/process-comment.ts)
6. `messages`/`messaging_postbacks`에서는 `fg:<uuid>` 버튼만 파싱한다. **팔로우 확인과 후속 DM은 현재 웹훅 POST 안에서 동기로 호출한다.** 일반 문의, 메시지 작성 시각, 수신 message ID, 대화 창은 별도 저장하지 않는다.

댓글 경로는 DB 기록 후 반환하지만 팔로우 버튼 경로는 API 응답을 기다린다. 둘을 동일한 빠른 ACK 경로라고 볼 수 없다.

## 3. 매칭·응답·우선순위

| 항목 | 현재 동작 | 확장 시 주의 |
| --- | --- | --- |
| 정규화 | NFKC, 소문자, 공백 병합·trim | 요청한 NFC와 다름. 기존 의미를 바꾸면 전각 영문 등의 회귀 발생 |
| 매칭 | contains/exact/any. exact는 양 끝 문장부호·기호·이모지 등을 제거, 이모지만인 키워드는 별도 보호 | 제외어 없음. 캠페인 NFC 정책을 명시적으로 추가 |
| 우선순위 | specific > all, 같은 범위는 키워드 > any > 최신 생성 | 이 순서를 기존 경로에서 보존 |
| next 게시물 | 게시물 작성 시각이 규칙 생성 뒤이면 최초 바인딩하여 specific으로 변경 | 캠페인 매칭이 이 부작용보다 앞서야 함 |
| 공개 답글 | 여러 템플릿 중 무작위 선택, `{username}` 렌더링. 대댓글 이벤트는 부모 댓글에 답함 | 순환 선택·캠페인당 공개 응답 중복·독립 rate bucket 없음 |
| 링크 DM | button template 우선, 형식 오류에 text로 fallback하고 계정 `dm_format` 기억 | fallback도 API 호출이므로 신규 제한·재시도 원장에 반영 필요 |

근거: [matcher.ts](../../src/server/automations/matcher.ts), [render.ts](../../src/server/automations/render.ts), [dm-content.ts](../../src/server/pipeline/dm-content.ts).

## 4. 중복 방지와 신뢰성의 현재 경계

- 댓글 단위: `comment_events.comment_id`가 전역 UNIQUE다.
- 사람 단위: `deliveries(automation_id, media_id, commenter_ig_id)` UNIQUE로 예약한다. 같은 이벤트 재시도는 기존 예약을 사용하고, 다른 이벤트면 duplicate로 끝낸다. 공구·여러 게시물 단위의 중복 방지는 없다. [deliveries.ts](../../src/server/pipeline/deliveries.ts)
- 공개 답글과 DM 성공을 각각 저장하여 확인된 성공 부분은 재시도하지 않는다. DM 영구 실패 시 delivery·월 사용량 예약을 해제한다.
- claim은 `FOR UPDATE SKIP LOCKED`; 5분 이상 processing은 회수한다. lease owner/version 검사는 없으며 완료 업데이트는 event ID로 수행한다.
- **Meta 성공과 로컬 DB 성공 기록은 하나의 트랜잭션이 아니다.** API 성공 후 프로세스가 죽거나 응답을 잃으면 공개 답글/일반 DM 재시도 중복 또는 결과 불명이 가능하다. DB UNIQUE만으로 외부 전송 exactly-once를 증명할 수 없다.
- 팔로우 후속 DM은 `follow_gates.status=sent`를 먼저 선점한다. 선점 후 API 전 장애에는 누락, API 성공 후 DB 기록 전 장애에는 결과 불명이 가능하다. 기존 테스트의 단순 재전달 방어와 장애 경계 보장은 다르다.

## 5. 발송 대기열·스케줄러·제한

| 구성 | 현재 구현 |
| --- | --- |
| 저장 대기열 | `comment_events` 자체가 영속 큐. 독립 DmJob 테이블 없음 |
| 실행 | [loop.ts](../../src/worker/loop.ts), 기본 concurrency 8, 2초 polling + LISTEN/NOTIFY |
| 예약 | `run_at`, `dm_reserved_at`, `locked_at`; `run_at` 순 claim |
| 재시작 | processing 5분 경과 회수. SIGTERM/SIGINT에서 진행 중 작업 drain |
| 제한 | [ratelimit.ts](../../src/server/ratelimit.ts)의 계정 advisory lock, 최근 1시간 예약 조회, `next_reply_at`. **토큰 버킷은 아님** |
| 기본 속도 | 환경변수 `IG_PRIVATE_REPLY_HOURLY_LIMIT`: 기본 700, 상한 750. 공개 답글·private reply가 한 이벤트 슬롯을 공유, 일반 DM은 이 경로를 거치지 않음 |
| 지연 | 슬롯 사이 1~3초. 5초 이하 inline sleep, 더 길면 DB에 재예약 |
| 오류 재시도 | 30초 × 2^(attempt−1), ±20%, transient 최대 5회. rate limit은 5분 후, attempt 환급하므로 동일한 횟수 상한 없음 |
| 만료 | `received_at + 7일`. 10분 주기 만료 잡도 수신 시각 기준. 작성 시각·1시간 여유 없음 |
| 주기 작업 | [scheduler.ts](../../src/worker/scheduler.ts)의 setInterval이 DB scan을 깨움. 토큰 갱신 1시간, 만료 10분, 정리 1시간, 결제 10분, heartbeat 10초 |
| 잡 잠금 | [jobs.ts](../../src/worker/jobs.ts)의 `pg_try_advisory_xact_lock`. 콜백은 별도 DB 연결을 쓸 수 있어 잠금 자체가 모든 업무 쓰기를 원자적으로 묶지는 않음 |

재사용할 것은 DB 큐, claim 패턴, worker loop, polling/NOTIFY, backoff, 주기 scan 구조다. 미래 발송을 setTimeout만으로 예약하지 않는다. 현재 rate limiter는 **실제 호출 시각**보다 예약 시각을 세므로 재시작 뒤 밀린 슬롯의 집중 실행을 별도로 검증해야 한다.

## 6. Meta 클라이언트·팔로우 흐름

- Instagram API with Instagram Login, `graph.instagram.com`, 환경변수 기본 `v26.0`. [graph.ts](../../src/server/instagram/graph.ts), [env.ts](../../src/server/env.ts)
- OAuth scope: `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`. 계정 구독은 `comments,messages,messaging_postbacks`. [oauth.ts](../../src/server/instagram/oauth.ts)
- private reply는 `recipient.comment_id`, 일반 DM은 `recipient.id`. 네트워크 timeout 10초.
- 기존 팔로워 옵션은 최초에 팔로우 여부를 조회하지 않고 모두에게 팔로우 요청 private reply를 보낸다. postback/quick reply 후 `is_user_follow_business`를 조회하여 후속 일반 DM을 보낸다. 조회 동의 오류에는 quick reply를 추가 요청한다. [follow-gate.ts](../../src/server/pipeline/follow-gate.ts)
- 로컬 24시간 창 검증, follower 확인 실패 시 링크 기본 발송 설정, reminder 1회 제한, 캠페인 연결, 버튼 송신자와 원 댓글 작성자의 동일성 검증은 현재 구현에 없다.
- [errors.ts](../../src/server/instagram/errors.ts)는 4/17/32/613/80002/429를 rate limit, 190을 인증, 100/2534015를 형식, 5xx/1/2/네트워크를 transient로 분류한다. `10/2534022`의 UI 설명이 현재 “댓글 후 7일”로 고정되어 있어 실제 채널별 창 구분이 필요하다.
- 최신 공식 문서 확인 결과·권한별 근거·요청서와의 차이는 [설계 §2](01-design.md#2-meta-공식-문서-확인과-권한)에 기록한다.

## 7. 링크·집계·요금·화면

- 기존 단축 경로는 `/l/{code}`다. [links.ts](../../src/server/links.ts)와 [route.ts](../../src/app/l/[code]/route.ts)는 302/no-store, 7자리 base62, 원본 URL 저장, 누적 클릭·최초/최종 클릭 시각을 지원한다.
- `facebookexternalhit`, `facebot`, `meta-externalagent`, 일반 bot/crawler/preview 및 여러 메신저 UA를 이미 제외한다. UA 없는 요청도 제외한다. 이 구현을 재사용한다.
- 개별 ClickEvent, 수신자 HMAC, 시간대·상품·옵션 집계, UTM, report share, PDF, 가입 전환 측정은 없다. raw IP는 링크 테이블에 저장하지 않는다. HEAD 전용 집계 방어는 route에 별도로 없다.
- 링크는 발송 전 생성되고 `event_id`의 UNIQUE가 없다. [dashboard.ts](../../src/server/dashboard.ts)는 링크 row 수를 `linksSent`로 세므로 **실제 발송 성공 수와 일치한다고 보장할 수 없다**. 신규 리포트는 성공 원장을 기준으로 계산해야 한다.
- 플랜은 [plans.ts](../../src/lib/plans.ts)에 하드코딩: Free 자동화 3/월 DM 1,000, Pro 월 DM 10,000, 기존 Agency 월 DM 50,000. Agency 신규 판매는 중단하되 기존 구독은 유지한다. 현재 entitlement/feature flag 테이블·서비스는 없다.
- `src/app/app/automations`의 생성·편집·상세, `src/components/app/automation-wizard.tsx`, media picker, 대시보드·설정·결제 화면을 확장할 수 있다. 캠페인 CRUD/상태/일시정지/성과 보고 화면은 없다.

## 8. DB와 개인정보

현재 16개 테이블:

| 그룹 | 테이블 |
| --- | --- |
| 인증 | `user`, `session`, `account`, `verification` |
| IG/자동화 | `ig_accounts`, `automations`, `media_cache` |
| 큐/중복/팔로우 | `comment_events`, `deliveries`, `follow_gates` |
| 링크/과금 | `links`, `usage_counters`, `subscriptions`, `payments` |
| 운영 | `data_deletion_requests`, `worker_heartbeats` |

[0000](../../drizzle/0000_narrow_abomination.sql), [0001](../../drizzle/0001_follow_gate.sql)과 Drizzle journal로 forward migration한다. down migration 실행기는 없다. 신규 변경은 롤백 SQL·안전 조건·up/down/up 테스트가 필요하다.

IG 토큰 `ig_accounts.access_token_enc`와 PortOne billing key는 [crypto.ts](../../src/server/crypto.ts)의 AES-256-GCM으로 암호화하며 환경 키 `ENCRYPTION_KEY`를 사용한다. 키 버전별 회전·KMS는 없다. Better Auth `account`의 OAuth token 필드는 별도이며, IG 토큰 암호화 사실을 모든 토큰의 암호화로 확대 해석하지 않는다.

현재 보존 정책은 no_match/self skipped 3일, 지정된 종료 상태 180일, media cache 30일이다. `awaiting_follow`는 cleanup 종료 상태 목록에 없어 오래 남을 수 있다. 댓글 원문·username·IGSID를 저장하며 캠페인용 90일 비식별화/삭제는 없다.

Meta deauthorize/data deletion은 signed_request를 검증한다. 연결 해제는 토큰 제거·자동화 비활성화, 삭제는 links를 먼저 삭제하고 계정 FK cascade를 사용한다. [meta-callbacks.ts](../../src/server/instagram/meta-callbacks.ts) 신규 공구 데이터·공유 토큰·집계·PDF까지 삭제 범위를 확장해야 한다.

## 9. 관측성·테스트 현황

JSON log와 heartbeat/`/api/health?strict=1`, 재인증 이메일이 있다. 계정별 발송 속도·오류 연속 횟수·캠페인 deadline 위험 지표, circuit breaker, 알림 outbox는 없다. `notifyUser`는 이메일 실패를 로그로 남기며 영속 재시도는 없다.

[Vitest 설정](../../vitest.config.ts)은 unit/integration 프로젝트를 나눈다. integration은 PostgreSQL 스키마를 초기화하고 실제 migration을 실행하며 파일을 직렬 실행한다. [FakeGraphClient](../../tests/helpers/fake-graph.ts)와 fetch stub을 쓰며, 실서비스에서 녹화·익명화한 응답 fixture 모음은 없다.

기존 테스트는 정규화/우선순위, 웹훅 서명·파서·중복 수집, concurrent claim/5분 회수, rate 슬롯, pipeline 재시도/부분 성공/만료, follow gate, 링크 bot 제외, 토큰 암호화·계정 삭제, 요금·결제·대시보드 등을 다룬다. 공구·3,000건 부하·외부 성공 직후 crash·브라우저 E2E/PDF 수치 동등성 테스트는 없다.

**이번 조사에서 실행한 기준선: 37개 테스트 파일, 243개 테스트 전부 통과(41.12초).**

- `pnpm install --frozen-lockfile`: lockfile 유지, Node v24.20.0 / pnpm 10.28.1.
- `TEST_DATABASE_URL=<조사용 격리 PostgreSQL URL> pnpm test`: PostgreSQL 17 임시 컨테이너의 전용 DB에서 실행. 초기화 대상은 이 DB뿐이다.
- Vite의 향후 native config loader 전환 안내가 있었으며 실패는 없었다.
- 이 결과는 현재 자동화 기준선이다. 공구 완료 기준·부하·실제 Meta 2계정 흐름을 통과했다는 뜻은 아니다. 이번 단계에서는 실제 댓글·DM·배포를 실행하지 않았다.

## 10. 재사용 및 구현 전 결정 요약

| 재사용 | 확장/보강 |
| --- | --- |
| 웹훅 서명·큰 ID 파서·comment_events | Meta 작성 시각, 캠페인 수신 상태, 라우팅 소유권, 메시지 inbox |
| PostgreSQL 큐·worker·scheduler | 채널별 잡, deadline 우선순위, fenced lease, 전송 결과 불명 상태 |
| deliveries의 UNIQUE 예약 패턴 | 캠페인/사람/의도 중복 원장, private reply 전역 소비 원장 |
| Graph client·follow gate·템플릿 | consent/24시간 창, 송신자 검증, 비동기 처리, 안전한 fallback |
| rate limiter의 DB 잠금 | 3개 채널 bucket, 실제 호출 제한, 재시작 burst 방어 |
| `/l` 링크·bot 필터 | campaign/product/option, ClickEvent, HMAC, 성공 기준 리포트 |
| 인증·소유권 검증·결제·알림 | DB entitlement/flag, 상태 감사, 일시정지·알림 재시도 |

가장 중요한 열린 문제는 외부 전송의 결과 불명 처리, 댓글만 남긴 사람의 팔로우 조회 동의, 기존 과금과 공구 과금의 공존이다. 설계에서 선택지와 권고안을 정리하고 리뷰 승인을 기다린다.
