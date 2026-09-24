# 인스타그램 댓글 자동응답 서비스 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 키워드 댓글에 공개 답글과 Private Reply DM을 자동 발송하는 SaaS를 만든다. 범위는 연동, 자동화, 대시보드, 클릭 추적, 포트원 정기결제, 법적 페이지다. VPS에서 Docker Compose로 운영한다.

**Architecture:** 하나의 Next.js 16 코드베이스를 이미지 하나로 빌드해 `web`(Next.js standalone)과 `worker`(esbuild 번들 Node 프로세스)로 실행한다.
- **큐:** 별도 브로커 없이 Postgres `comment_events` 테이블 자체가 큐다. `LISTEN/NOTIFY`와 `FOR UPDATE SKIP LOCKED`를 쓴다.
- **도메인 로직:** 모두 `src/server/**`에 둔다. 외부 API(Instagram Graph, 포트원)는 인터페이스 뒤에 두고 주입하므로, 통합 테스트는 실제 Postgres와 Fake 클라이언트로 돌린다.

**Tech Stack:** Node 24, pnpm 10, Next.js 16 (App Router), React 19, TypeScript 5.9, Tailwind v4 + shadcn/ui, PostgreSQL 17, Drizzle ORM 0.45 + drizzle-kit, postgres.js, Better Auth 1.7, Resend, 포트원 V2(`@portone/browser-sdk`, `@portone/server-sdk`), zod 4, Vitest, esbuild, Docker Compose, Traefik(기존), GitHub Actions + GHCR.

**Spec:** `docs/superpowers/specs/2026-09-24-instagram-comment-automation-design.md`

## Global Constraints

- **런타임·언어:**
  - Node 24, 패키지 매니저는 pnpm, TypeScript는 **5.9.x**를 쓴다. TypeScript 7은 쓰지 않는다.
  - 모든 사용자 노출 문구는 한국어로 쓰고, 화면은 375px 폭 모바일 우선으로 만든다.
- **Next.js 16 규칙:**
  - `params`, `searchParams`, `cookies()`, `headers()`는 모두 `await`한다. 미들웨어가 필요하면 `proxy.ts`를 쓴다.
  - `NEXT_PUBLIC_*` 환경변수는 쓰지 않는다. 클라이언트가 필요한 값은 서버 컴포넌트가 props로 넘긴다.
- **DB 규칙:**
  - 시각 컬럼은 전부 `timestamptz`(`withTimezone: true`)다.
  - Instagram ID는 항상 `string`으로 다룬다. JSON 파싱 시 15자리 이상 숫자 ID는 문자열로 바꾼다.
- **Instagram 호출:**
  - Graph API 버전은 `IG_GRAPH_API_VERSION`, 기본 `v26.0`이다.
  - 호스트는 `https://graph.instagram.com/{version}`이다. OAuth는 `https://www.instagram.com/oauth/authorize`와 `https://api.instagram.com/oauth/access_token`을 쓴다.
  - Private Reply 계정당 시간당 한도는 `IG_PRIVATE_REPLY_HOURLY_LIMIT`, 기본 700이고 750을 넘으면 안 된다.
- **플랜 값** (`src/lib/plans.ts`가 단일 소스):

  | 플랜 | 월 요금 | 계정 | 활성 자동화 | 월 DM | 링크 추적 | 브랜드 문구 |
  |---|---|---|---|---|---|---|
  | free | 0원 | 1 | 1 | 300 | X | O |
  | pro | 9,900원 | 1 | 무제한 | 10,000 | O | X |
  | agency | 59,000원 | 5 | 무제한 | 50,000 | O | X |

- **보안:**
  - 토큰, 빌링키, 이메일, 댓글 원문은 로그에 남기지 않는다.
  - 토큰과 빌링키는 `encryptSecret`(AES-256-GCM)으로 저장한다.
- **서비스명과 사업자 정보:** `src/lib/site.ts` 한 곳에만 둔다. 서비스명은 "리치업(ReachUp)", 도메인 후보는 reachup.kr·reachup.co.kr이다.
- **디자인 기준:** 시안은 `docs/design/*.dc.html`(원본 캔버스 https://claude.ai/artifact/SRaJbXr46m8aYjGvgcjn16)이다.
  - 이 계획의 UI 코드는 동작과 데이터 연결의 기준이다. 레이아웃·간격·문구·색은 시안에 맞춘다.
  - 색 토큰: 배경 #F5F1EA, 카드 #FFFFFF, 글자 #16120E, 보조 글자 #3D352E, 흐린 글자 #6E655C, 선 #E3DBCF, 입력 테두리 #D8CFC3, 포인트 #FF5B35(글자로 쓸 땐 #D9401C), 키워드 칩 #FFE3D9/#7A2410, 성공 #DDF2E6/#14573A, 경고 #FFF0D1/#7A4700, 실패 #FBE3E0/#8F1D16, 중립 #EEE9E2/#4A423B.
  - 서체: 제목은 Hahmlet(600·700·800), 본문과 UI는 IBM Plex Sans KR(400~700). `next/font/google`로 불러온다.
  - 위자드(`/app/automations/new`, `/app/automations/[id]/edit`)에서는 하단 내비를 숨기고 하단 고정 이전/다음 바를 쓴다.
  - 이모지는 UI와 기본 문구에 쓰지 않는다.
- **"모든 댓글" 자동화:** `match_type = 'any'`이면 키워드 없이 모든 댓글에 반응한다(본인 댓글 제외, 같은 사람에게 1회). 같은 범위 안에서는 키워드 자동화가 `any`보다 먼저 선택된다.
- **커밋 메시지:** `Co-Authored-By` 트레일러와 "Generated with Claude Code" 문구를 넣지 않는다.
- **테스트 DB:**
  - `TEST_DATABASE_URL`, 기본값 `postgres://postgres:postgres@localhost:54329/igc_test`를 쓴다.
  - 로컬 Postgres는 `pnpm db:up`(docker-compose.dev.yml, 포트 54329)으로 띄운다.

## Review Focus

1. **우리 답글이 웹훅으로 되돌아오는 경우:** `from.id == entry.id`, 사용자명 일치, 또는 우리가 단 답글 ID와 같으면 절대 답하지 않아야 한다. 테스트는 Task 10(파이프라인 self 3종)과 Task 13(수집 단계 필터)에 둔다.
2. **같은 댓글 웹훅이 반복 전달되는 경우:** Meta는 최대 36시간 재전송하고 광고 게시물은 이중 전달된다. 답글과 DM은 정확히 1회만 나가야 한다. 테스트는 Task 9(enqueue 멱등)와 Task 13(같은 payload 두 번 POST)에 둔다.
3. **한 계정에 시간당 700건을 넘는 댓글이 몰리는 경우:** 슬롯이 1시간 윈도를 넘지 않게 퍼져야 하고, 다른 계정 이벤트가 5초 넘게 막히면 안 된다. 테스트는 Task 8(한도 초과 시 +1시간 슬롯)과 Task 10(5초 초과 슬롯은 큐로 반환)에 둔다.
4. **한국어·이모지·전각 문자 댓글:** "공구🙏", "ＬＩＮＫ", "공구요!!", "@친구 공구" 같은 입력을 정규화 규칙대로 매칭해야 한다. 테스트는 Task 4에 둔다.
5. **결제 직후 프로세스가 죽거나 응답이 유실되는 경우:** 갱신 결제가 이중 청구되면 안 된다. 결정적 paymentId와 `ALREADY_PAID` 처리로 막는다. 테스트는 Task 18(charge 예외 후 재실행)에 둔다.

## File Structure

```
package.json, pnpm-lock.yaml, tsconfig.json, next.config.ts, eslint.config.mjs, vitest.config.ts,
drizzle.config.ts, components.json, docker-compose.dev.yml, .env.example, Dockerfile, .dockerignore
drizzle/                               drizzle-kit 생성 마이그레이션 (커밋)
scripts/build-worker.mjs               esbuild로 dist/worker.mjs, dist/migrate.mjs 번들
scripts/simulate-comment.ts            서명된 가짜 comments 웹훅 전송
deploy/docker-compose.yml, deploy/.env.example, deploy/backup.sh
.github/workflows/ci.yml, .github/workflows/deploy.yml
docs/runbook.md
src/lib/site.ts                        서비스명·사업자 정보
src/lib/plans.ts                       플랜 정의(클라이언트·서버 공용)
src/lib/automation-schema.ts           자동화 입력 zod 스키마(공용)
src/lib/utils.ts                       shadcn cn()
src/lib/auth-client.ts                 Better Auth 클라이언트
src/server/env.ts                      zod 환경변수(지연 파싱)
src/server/log.ts                      JSON 로거
src/server/crypto.ts                   AES-256-GCM, randomToken
src/server/db/schema.ts                전체 스키마
src/server/db/client.ts                getDb()/getSql()/createDb(), Db/Tx/Executor 타입
src/server/db/migrate.ts               마이그레이터 엔트리
src/server/auth.ts, src/server/session.ts
src/server/email.ts, src/server/emails.ts
src/server/instagram/json.ts           큰 숫자 ID 안전 파싱
src/server/instagram/errors.ts         GraphApiError, classifyError, errorReasonKo
src/server/instagram/webhook.ts        서명 검증, comments 파싱
src/server/instagram/signed-request.ts Meta signed_request
src/server/instagram/graph.ts          GraphClient 인터페이스 + HTTP 구현
src/server/instagram/oauth.ts          인가 URL, 토큰 교환
src/server/instagram/connect.ts        연동 유스케이스
src/server/instagram/meta-callbacks.ts 연결 해제·데이터 삭제
src/server/automations/matcher.ts      정규화·매칭·스코프 선택
src/server/automations/render.ts       답글 렌더, DM 텍스트 폴백
src/server/automations/service.ts      자동화 CRUD·활성화 한도
src/server/billing/plan-of.ts          effectivePlan/getUserPlan
src/server/billing/periods.ts          KST 기간 계산
src/server/billing/gateway.ts          BillingGateway + 포트원 구현
src/server/billing/subscriptions.ts    구독·갱신·해지·플랜 한도 적용
src/server/usage.ts                    월 DM 사용량
src/server/ratelimit.ts                reserveSendSlot
src/server/links.ts                    단축 링크
src/server/queue/backoff.ts, src/server/queue/events.ts, src/server/queue/ingest.ts
src/server/pipeline/deliveries.ts, src/server/pipeline/process-comment.ts
src/server/dashboard.ts                대시보드 집계
src/server/account.ts                  계정 연결 해제·회원 탈퇴
src/worker/index.ts, loop.ts, scheduler.ts, jobs.ts
src/app/...                            화면·라우트 (Task 12~19)
tests/unit/**, tests/integration/**, tests/helpers/**
```

---

### Task 1: 프로젝트 스캐폴드, 환경변수, 테스트 러너

**Files:**
- Create (생성기): `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `src/app/*`, `components.json`, `src/components/ui/*`, `src/lib/utils.ts`
- Create: `docker-compose.dev.yml`, `.env.example`, `vitest.config.ts`, `src/server/env.ts`, `src/server/log.ts`, `src/lib/site.ts`
- Modify: `.gitignore`, `next.config.ts`, `package.json` (scripts), `eslint.config.mjs` (ignores)
- Test: `tests/unit/env.test.ts`

**Interfaces:**
- Produces:
  - `parseEnv(source: Record<string, string | undefined>): Env`
  - `getEnv(): Env` (지연 파싱·캐시)
  - `log.info/warn/error(msg: string, fields?: Record<string, unknown>)`
  - `errorFields(e: unknown)`
  - `site` 객체 (`name`, `description`, `supportEmail`, `business{...}`, `privacyOfficer{...}`, `effectiveDate`; Task 14에서 `hostingProvider` 추가)

- [ ] **Step 1: Next.js 앱 생성**

`docs/`, `.git`, `.gitignore`는 create-next-app의 허용 목록이라 충돌하지 않는다.

```bash
cd /Users/sangheon/Documents/workspace/Monetization/instagram-comment
pnpm create next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --yes
```
Expected: `src/app/page.tsx`, `package.json` 생성. `next` 버전이 16.x인지 `pnpm list next`로 확인.

- [ ] **Step 2: 의존성 설치 (TypeScript 5.9 고정)**

```bash
pnpm add drizzle-orm postgres better-auth zod resend @portone/browser-sdk @portone/server-sdk lucide-react
pnpm add -D typescript@5.9.3 drizzle-kit vitest esbuild tsx @types/node
```
Expected: 설치 성공. `pnpm exec tsc -v` → `Version 5.9.3`.

- [ ] **Step 3: shadcn/ui 초기화와 컴포넌트 추가**

```bash
pnpm dlx shadcn@latest init --yes --base-color neutral
pnpm dlx shadcn@latest add --yes button card input label textarea badge switch alert separator sonner radio-group progress alert-dialog
```
Expected: `components.json`, `src/lib/utils.ts`, `src/components/ui/*.tsx`가 생성된다.
- 플래그가 바뀌어 프롬프트가 뜨면 `pnpm dlx shadcn@latest init --help`로 확인한 비대화형 옵션을 쓴다(기본값 선택).
- 컴포넌트 라이브러리(Radix / Base UI)를 물으면 **Radix**를 고른다. 이후 Task의 코드는 Radix 기반 shadcn API(`AlertDialogAction`, `onCheckedChange`, `onValueChange`, `buttonVariants`)를 전제로 한다.

- [ ] **Step 4: `.gitignore`에 항목 추가**

create-next-app이 덮어쓴 `.gitignore` 끝에 추가:
```gitignore
# project
dist/
coverage/
.env
.env.*
!.env.example
deploy/.env
deploy/backups/
```

- [ ] **Step 5: 개발용 Postgres (`docker-compose.dev.yml`)**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: igc_dev
    ports:
      - "54329:5432"
    volumes:
      - igc-dev-pg:/var/lib/postgresql/data
      - ./scripts/dev-db-init.sql:/docker-entrypoint-initdb.d/init.sql:ro
volumes:
  igc-dev-pg: {}
```
`scripts/dev-db-init.sql`:
```sql
CREATE DATABASE igc_test;
```
Run: `open -a Docker` (Docker Desktop이 꺼져 있으면), 그 다음 `docker compose -f docker-compose.dev.yml up -d`
Expected: `docker compose -f docker-compose.dev.yml ps`에 postgres `running`.

- [ ] **Step 6: 실패하는 env 테스트 작성 (`tests/unit/env.test.ts`)**

```ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/env";

const base = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "a".repeat(32),
  IG_APP_ID: "123",
  IG_APP_SECRET: "secret",
  IG_WEBHOOK_VERIFY_TOKEN: "verify-token",
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
};

describe("parseEnv", () => {
  it("applies defaults", () => {
    const env = parseEnv(base);
    expect(env.IG_GRAPH_API_VERSION).toBe("v26.0");
    expect(env.IG_PRIVATE_REPLY_HOURLY_LIMIT).toBe(700);
    expect(env.WORKER_CONCURRENCY).toBe(8);
  });

  it("treats empty strings as unset", () => {
    const env = parseEnv({ ...base, KAKAO_CLIENT_ID: "", META_APP_SECRET: "" });
    expect(env.KAKAO_CLIENT_ID).toBeUndefined();
    expect(env.META_APP_SECRET).toBeUndefined();
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    expect(() => parseEnv({ ...base, ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/ENCRYPTION_KEY/);
  });

  it("rejects an hourly limit above 750", () => {
    expect(() => parseEnv({ ...base, IG_PRIVATE_REPLY_HOURLY_LIMIT: "800" })).toThrow();
  });
});
```

- [ ] **Step 7: `vitest.config.ts` 작성**

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/integration/setup-env.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
```
Vitest 버전에서 `projects`/`extends` 문법이 거부되면 Context7로 `vitest` "projects" 문서를 확인해 같은 의미로 고친다.

- [ ] **Step 8: 테스트가 실패하는지 확인**

Run: `pnpm vitest run --project unit tests/unit/env.test.ts`
Expected: FAIL — `Cannot find module '@/server/env'`

- [ ] **Step 9: `src/server/env.ts` 구현**

```ts
import { z } from "zod";

const optional = z.string().min(1).optional();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  KAKAO_CLIENT_ID: optional,
  KAKAO_CLIENT_SECRET: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  RESEND_API_KEY: optional,
  EMAIL_FROM: z.string().min(3).default("noreply@localhost"),
  IG_APP_ID: z.string().min(1),
  IG_APP_SECRET: z.string().min(1),
  META_APP_SECRET: optional,
  IG_WEBHOOK_VERIFY_TOKEN: z.string().min(8),
  IG_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0"),
  IG_PRIVATE_REPLY_HOURLY_LIMIT: z.coerce.number().int().positive().max(750).default(700),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "ENCRYPTION_KEY must be 32 bytes (base64)"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(64).default(8),
  PORTONE_STORE_ID: optional,
  PORTONE_CHANNEL_KEY: optional,
  PORTONE_API_SECRET: optional,
  PORTONE_WEBHOOK_SECRET: optional,
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ""),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
```

- [ ] **Step 10: 테스트 통과 확인**

Run: `pnpm vitest run --project unit tests/unit/env.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 11: 로거 (`src/server/log.ts`)**

```ts
type Fields = Record<string, unknown>;
type Level = "info" | "warn" | "error";

function write(level: Level, msg: string, fields?: Fields) {
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, fields?: Fields) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields) => write("error", msg, fields),
};

export function errorFields(e: unknown): Fields {
  return e instanceof Error ? { error: e.message, errorName: e.name } : { error: String(e) };
}
```

- [ ] **Step 12: 서비스·사업자 정보 (`src/lib/site.ts`)**

```ts
export const site = {
  name: "리치업",
  description: "댓글 키워드 하나로 공개 답글과 DM 링크를 자동 발송하는 인스타그램 자동화 도구",
  supportEmail: "support@example.com",
  effectiveDate: "2026-10-01",
  business: {
    companyName: "",
    ceo: "",
    registrationNumber: "",
    mailOrderNumber: "",
    address: "",
    phone: "",
  },
  privacyOfficer: { name: "", email: "support@example.com" },
} as const;
```
빈 값은 법적 페이지에서 노란 "[… 입력 필요]"로 표시된다(Task 14 `Placeholder`). PG 심사와 Meta 검수 전에 반드시 채운다.

- [ ] **Step 13: `next.config.ts` 교체**

```ts
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
```

- [ ] **Step 14: `package.json` scripts와 ESLint ignore**

`package.json`의 `"scripts"`를 다음으로 교체한다. `"packageManager"`가 없으면 `"packageManager": "pnpm@10.28.1"`을 추가한다.
```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:unit": "vitest run --project unit",
  "test:int": "vitest run --project integration",
  "db:up": "docker compose -f docker-compose.dev.yml up -d",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "tsx --env-file=.env src/server/db/migrate.ts",
  "worker:dev": "tsx watch --env-file=.env src/worker/index.ts",
  "build:worker": "node scripts/build-worker.mjs",
  "simulate:comment": "tsx --env-file=.env scripts/simulate-comment.ts"
}
```
`eslint.config.mjs`의 ignore 목록(`globalIgnores([...])` 또는 `ignores`)에 `"dist/**"`, `"drizzle/**"`, `"deploy/**"`, `"coverage/**"`를 추가한다.

- [ ] **Step 15: `.env.example` 작성**

```dotenv
APP_URL=http://localhost:3000
DATABASE_URL=postgres://postgres:postgres@localhost:54329/igc_dev
BETTER_AUTH_SECRET=change-me-to-a-random-string-of-32-chars-min
# openssl rand -base64 32
ENCRYPTION_KEY=
KAKAO_CLIENT_ID=
KAKAO_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
RESEND_API_KEY=
EMAIL_FROM=리치업 <noreply@example.com>
IG_APP_ID=
IG_APP_SECRET=
META_APP_SECRET=
IG_WEBHOOK_VERIFY_TOKEN=change-me-verify-token
IG_GRAPH_API_VERSION=v26.0
IG_PRIVATE_REPLY_HOURLY_LIMIT=700
WORKER_CONCURRENCY=8
PORTONE_STORE_ID=
PORTONE_CHANNEL_KEY=
PORTONE_API_SECRET=
PORTONE_WEBHOOK_SECRET=
```
로컬 개발용으로 `cp .env.example .env` 후 `ENCRYPTION_KEY=$(openssl rand -base64 32)`, `IG_APP_ID=dev`, `IG_APP_SECRET=dev-secret`을 채운다(`.env`는 커밋하지 않음).

- [ ] **Step 16: 타입체크·린트·테스트 통과 확인**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: 오류 없음, unit 4 tests PASS.

- [ ] **Step 17: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 16 app with env validation, shadcn/ui and vitest"
```

---

### Task 2: 암호화와 안전한 JSON 파싱

**Files:**
- Create: `src/server/crypto.ts`, `src/server/instagram/json.ts`
- Test: `tests/unit/crypto.test.ts`, `tests/unit/json.test.ts`

**Interfaces:**
- Consumes: `getEnv()` (Task 1)
- Produces:
  - `encryptWithKey(plain: string, keyB64: string): string`
  - `decryptWithKey(payload: string, keyB64: string): string`
  - `encryptSecret(plain: string): string`
  - `decryptSecret(payload: string): string`
  - `randomToken(bytes?: number): string`
  - `safeEqual(a: string, b: string): boolean`
  - `parseJsonWithStringIds(text: string): unknown`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/unit/crypto.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { decryptWithKey, encryptWithKey, randomToken, safeEqual } from "@/server/crypto";

const key = Buffer.alloc(32, 9).toString("base64");
const otherKey = Buffer.alloc(32, 3).toString("base64");

describe("AES-256-GCM", () => {
  it("round-trips unicode text", () => {
    const enc = encryptWithKey("토큰-abc-🙂", key);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decryptWithKey(enc, key)).toBe("토큰-abc-🙂");
  });

  it("uses a random IV per call", () => {
    expect(encryptWithKey("same", key)).not.toBe(encryptWithKey("same", key));
  });

  it("round-trips an empty string", () => {
    expect(decryptWithKey(encryptWithKey("", key), key)).toBe("");
  });

  it("rejects tampered ciphertext", () => {
    const [v, iv, tag, ct] = encryptWithKey("secret", key).split(":");
    const flipped = Buffer.from(ct, "base64url");
    flipped[0] ^= 0xff;
    expect(() => decryptWithKey([v, iv, tag, flipped.toString("base64url")].join(":"), key)).toThrow();
  });

  it("rejects the wrong key", () => {
    expect(() => decryptWithKey(encryptWithKey("secret", key), otherKey)).toThrow();
  });

  it("rejects malformed payloads", () => {
    expect(() => decryptWithKey("v2:a:b:c", key)).toThrow(/malformed/);
  });
});

describe("helpers", () => {
  it("randomToken returns url-safe strings", () => {
    expect(randomToken(32)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("safeEqual compares strings in constant time", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
```

`tests/unit/json.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseJsonWithStringIds } from "@/server/instagram/json";

describe("parseJsonWithStringIds", () => {
  it("keeps large numeric ids exact as strings", () => {
    const parsed = parseJsonWithStringIds('{"user_id": 17841400000000001, "id": 12}') as Record<string, unknown>;
    expect(parsed.user_id).toBe("17841400000000001");
    expect(parsed.id).toBe(12);
  });

  it("does not touch ids inside string values", () => {
    const parsed = parseJsonWithStringIds('{"text":"\\"id\\": 17841400000000001"}') as { text: string };
    expect(parsed.text).toBe('"id": 17841400000000001');
  });

  it("converts nested recipient ids", () => {
    const parsed = parseJsonWithStringIds('{"recipient_id": 5261234567890123456}') as { recipient_id: string };
    expect(parsed.recipient_id).toBe("5261234567890123456");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --project unit tests/unit/crypto.test.ts tests/unit/json.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `src/server/crypto.ts` 구현**

```ts
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/server/env";

const VERSION = "v1";

function keyFrom(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
  return key;
}

export function encryptWithKey(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(keyB64), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":");
}

export function decryptWithKey(payload: string, keyB64: string): string {
  const parts = payload.split(":");
  const [version, iv, tag, ct] = parts;
  if (parts.length !== 4 || version !== VERSION || !iv || !tag) throw new Error("malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(keyB64), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export function encryptSecret(plain: string): string {
  return encryptWithKey(plain, getEnv().ENCRYPTION_KEY);
}

export function decryptSecret(payload: string): string {
  return decryptWithKey(payload, getEnv().ENCRYPTION_KEY);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
```

- [ ] **Step 4: `src/server/instagram/json.ts` 구현**

```ts
const LARGE_ID = /"(id|user_id|ig_id|recipient_id|sender_id)"\s*:\s*(\d{15,})/g;

/** Instagram ID는 2^53을 넘을 수 있어 JSON.parse 전에 문자열로 바꾼다. */
export function parseJsonWithStringIds(text: string): unknown {
  return JSON.parse(text.replace(LARGE_ID, '"$1":"$2"'));
}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm vitest run --project unit tests/unit/crypto.test.ts tests/unit/json.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/crypto.ts src/server/instagram/json.ts tests/unit/crypto.test.ts tests/unit/json.test.ts
git commit -m "feat: add AES-256-GCM secret encryption and big-id safe JSON parsing"
```

---

### Task 3: DB 스키마, 마이그레이션, 통합 테스트 하네스

**Files:**
- Create: `src/server/db/schema.ts`, `src/server/db/client.ts`, `src/server/db/migrate.ts`, `drizzle.config.ts`, `drizzle/*` (생성)
- Create: `tests/integration/setup-env.ts`, `tests/integration/global-setup.ts`, `tests/helpers/db.ts`, `tests/helpers/factories.ts`
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Consumes: `getEnv()`, `encryptSecret()`
- Produces:
  - `getDb(): Db`
  - `getSql(): Sql`
  - `createDb(url, opts?) => { db: Db; sql: Sql }`
  - 타입: `Db`, `Tx`, `Executor`
  - 테이블: `user`, `session`, `account`, `verification`, `igAccounts`, `automations`, `mediaCache`, `commentEvents`, `deliveries`, `links`, `usageCounters`, `subscriptions`, `payments`, `dataDeletionRequests`, `workerHeartbeats`
  - 행 타입: `IgAccount`, `Automation`, `CommentEvent`, `Subscription`, `Payment`, `EventStatus`, `SkipReason`
  - 테스트 헬퍼: `resetDb()`, `createUser()`, `createIgAccount()`, `createAutomation()`, `createEvent()`, `setPlan()`

- [ ] **Step 1: `src/server/db/schema.ts` 작성**

```ts
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------- Better Auth core ----------
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: tz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tz("access_token_expires_at"),
    refreshTokenExpiresAt: tz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------- Service ----------
export const IG_ACCOUNT_STATUSES = ["active", "reauth_required", "disconnected"] as const;

export const igAccounts = pgTable(
  "ig_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    igUserId: text("ig_user_id").notNull().unique(),
    igScopedId: text("ig_scoped_id"),
    username: text("username").notNull(),
    profilePictureUrl: text("profile_picture_url"),
    accountType: text("account_type").notNull(),
    accessTokenEnc: text("access_token_enc"),
    tokenExpiresAt: tz("token_expires_at"),
    status: text("status", { enum: IG_ACCOUNT_STATUSES }).notNull().default("active"),
    nextReplyAt: tz("next_reply_at").notNull().defaultNow(),
    dmFormat: text("dm_format", { enum: ["button", "text"] }).notNull().default("button"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ig_accounts_user_idx").on(t.userId), index("ig_accounts_scoped_idx").on(t.igScopedId)],
);

export const MEDIA_SCOPES = ["specific", "all", "next"] as const;
export const MATCH_TYPES = ["contains", "exact", "any"] as const;

export const automations = pgTable(
  "automations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    igAccountId: uuid("ig_account_id")
      .notNull()
      .references(() => igAccounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mediaScope: text("media_scope", { enum: MEDIA_SCOPES }).notNull(),
    mediaId: text("media_id"),
    mediaThumbnailUrl: text("media_thumbnail_url"),
    mediaPermalink: text("media_permalink"),
    mediaCaption: text("media_caption"),
    keywords: text("keywords").array().notNull(),
    matchType: text("match_type", { enum: MATCH_TYPES }).notNull().default("contains"),
    replyEnabled: boolean("reply_enabled").notNull().default(true),
    replyTexts: text("reply_texts")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    dmText: text("dm_text").notNull(),
    dmButtonTitle: text("dm_button_title").notNull(),
    dmLinkUrl: text("dm_link_url").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("automations_account_active_idx").on(t.igAccountId, t.isActive),
    index("automations_user_idx").on(t.userId),
  ],
);

export const mediaCache = pgTable("media_cache", {
  mediaId: text("media_id").primaryKey(),
  igAccountId: uuid("ig_account_id")
    .notNull()
    .references(() => igAccounts.id, { onDelete: "cascade" }),
  timestamp: tz("timestamp"),
  permalink: text("permalink"),
  thumbnailUrl: text("thumbnail_url"),
  caption: text("caption"),
  mediaProductType: text("media_product_type"),
  fetchedAt: tz("fetched_at").notNull().defaultNow(),
});

export const EVENT_STATUSES = [
  "pending",
  "processing",
  "succeeded",
  "partial",
  "failed",
  "skipped",
  "expired",
] as const;
export const SKIP_REASONS = [
  "self",
  "no_match",
  "duplicate",
  "quota",
  "account_inactive",
  "automation_inactive",
] as const;
export const PART_STATUSES = ["sent", "failed", "skipped"] as const;

export const commentEvents = pgTable(
  "comment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    igAccountId: uuid("ig_account_id")
      .notNull()
      .references(() => igAccounts.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id").references(() => automations.id, { onDelete: "set null" }),
    commentId: text("comment_id").notNull().unique(),
    mediaId: text("media_id").notNull(),
    parentCommentId: text("parent_comment_id"),
    mediaProductType: text("media_product_type"),
    commenterIgId: text("commenter_ig_id").notNull(),
    commenterUsername: text("commenter_username"),
    commentText: text("comment_text").notNull().default(""),
    receivedAt: tz("received_at").notNull().defaultNow(),
    status: text("status", { enum: EVENT_STATUSES }).notNull().default("pending"),
    skipReason: text("skip_reason", { enum: SKIP_REASONS }),
    replyStatus: text("reply_status", { enum: PART_STATUSES }),
    dmStatus: text("dm_status", { enum: PART_STATUSES }),
    replyCommentId: text("reply_comment_id"),
    dmMessageId: text("dm_message_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
    usagePeriod: text("usage_period"),
    runAt: tz("run_at").notNull().defaultNow(),
    lockedAt: tz("locked_at"),
    dmReservedAt: tz("dm_reserved_at"),
    completedAt: tz("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("comment_events_queue_idx")
      .on(t.runAt)
      .where(sql`${t.status} in ('pending', 'processing')`),
    index("comment_events_rate_idx").on(t.igAccountId, t.dmReservedAt),
    index("comment_events_automation_idx").on(t.automationId, t.createdAt),
    index("comment_events_account_created_idx").on(t.igAccountId, t.createdAt),
    index("comment_events_reply_idx").on(t.replyCommentId),
  ],
);

export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    mediaId: text("media_id").notNull(),
    commenterIgId: text("commenter_ig_id").notNull(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => commentEvents.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("deliveries_unique_idx").on(t.automationId, t.mediaId, t.commenterIgId),
    index("deliveries_event_idx").on(t.eventId),
  ],
);

export const links = pgTable(
  "links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    automationId: uuid("automation_id").references(() => automations.id, { onDelete: "set null" }),
    eventId: uuid("event_id").references(() => commentEvents.id, { onDelete: "set null" }),
    targetUrl: text("target_url").notNull(),
    clickCount: integer("click_count").notNull().default(0),
    firstClickedAt: tz("first_clicked_at"),
    lastClickedAt: tz("last_clicked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("links_automation_idx").on(t.automationId), index("links_event_idx").on(t.eventId)],
);

export const usageCounters = pgTable(
  "usage_counters",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    dmCount: integer("dm_count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.period] })],
);

export const PLAN_IDS = ["free", "pro", "agency"] as const;
export const SUBSCRIPTION_STATUSES = ["active", "past_due", "canceled"] as const;

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  plan: text("plan", { enum: PLAN_IDS }).notNull().default("free"),
  status: text("status", { enum: SUBSCRIPTION_STATUSES }).notNull().default("active"),
  billingKeyEnc: text("billing_key_enc"),
  cardLabel: text("card_label"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  billingAnchorAt: tz("billing_anchor_at"),
  currentPeriodStart: tz("current_period_start"),
  currentPeriodEnd: tz("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  pendingPlan: text("pending_plan", { enum: PLAN_IDS }),
  retryCount: integer("retry_count").notNull().default(0),
  nextRetryAt: tz("next_retry_at"),
  billingLockedUntil: tz("billing_locked_until"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const PAYMENT_STATUSES = ["pending", "paid", "failed", "canceled"] as const;

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
    paymentId: text("payment_id").notNull().unique(),
    plan: text("plan", { enum: PLAN_IDS }).notNull(),
    amount: integer("amount").notNull(),
    status: text("status", { enum: PAYMENT_STATUSES }).notNull().default("pending"),
    failureReason: text("failure_reason"),
    periodStart: tz("period_start"),
    periodEnd: tz("period_end"),
    paidAt: tz("paid_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payments_user_idx").on(t.userId, t.createdAt)],
);

export const dataDeletionRequests = pgTable("data_deletion_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  confirmationCode: text("confirmation_code").notNull().unique(),
  igUserId: text("ig_user_id").notNull(),
  status: text("status", { enum: ["received", "completed"] }).notNull().default("received"),
  createdAt: createdAt(),
  completedAt: tz("completed_at"),
});

export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  beatAt: tz("beat_at").notNull(),
});

export type IgAccount = typeof igAccounts.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type NewAutomation = typeof automations.$inferInsert;
export type CommentEvent = typeof commentEvents.$inferSelect;
export type NewCommentEvent = typeof commentEvents.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export type SkipReason = (typeof SKIP_REASONS)[number];
export type PartStatus = (typeof PART_STATUSES)[number];
```

- [ ] **Step 2: `src/server/db/client.ts` 작성**

```ts
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/server/env";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;
export type Sql = postgres.Sql;

export function createDb(url: string, opts: { max?: number } = {}): { db: Db; sql: Sql } {
  const sql = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

const globalForDb = globalThis as unknown as { __igcDb?: { db: Db; sql: Sql } };

function connection() {
  globalForDb.__igcDb ??= createDb(getEnv().DATABASE_URL);
  return globalForDb.__igcDb;
}

export function getDb(): Db {
  return connection().db;
}

export function getSql(): Sql {
  return connection().sql;
}
```

- [ ] **Step 3: `drizzle.config.ts`와 마이그레이터**

`drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/igc_dev" },
});
```
`src/server/db/migrate.ts` (별칭 import 금지 — esbuild·tsx 단독 실행용):
```ts
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const sql = postgres(url, { max: 1, onnotice: () => {} });
await migrate(drizzle(sql), { migrationsFolder: process.env.MIGRATIONS_DIR ?? "drizzle" });
await sql.end();
console.log(JSON.stringify({ level: "info", msg: "migrations applied" }));
```

- [ ] **Step 4: 마이그레이션 생성·적용**

Run: `pnpm db:generate && pnpm db:migrate`
Expected: `drizzle/0000_*.sql` 생성, `migrations applied` 출력. `psql postgres://postgres:postgres@localhost:54329/igc_dev -c '\dt'`에 15개 테이블 + `__drizzle_migrations`(drizzle 스키마).

- [ ] **Step 5: 통합 테스트 하네스**

`tests/integration/setup-env.ts`:
```ts
const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/igc_test";

Object.assign(process.env, {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: TEST_DB,
  BETTER_AUTH_SECRET: "test-secret-".padEnd(40, "x"),
  IG_APP_ID: "ig-app-id",
  IG_APP_SECRET: "ig-app-secret",
  META_APP_SECRET: "meta-app-secret",
  IG_WEBHOOK_VERIFY_TOKEN: "verify-token-123",
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  PORTONE_WEBHOOK_SECRET: Buffer.from("portone-webhook-secret").toString("base64"),
});
```
`tests/integration/global-setup.ts`:
```ts
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/igc_test";
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql`drop schema if exists public cascade`;
  await sql`drop schema if exists drizzle cascade`;
  await sql`create schema public`;
  await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
  await sql.end();
}
```
`tests/helpers/db.ts`:
```ts
import { getSql } from "@/server/db/client";

export async function resetDb(): Promise<void> {
  const sql = getSql();
  const tables = await sql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public'`;
  if (tables.length === 0) return;
  await sql.unsafe(
    `truncate table ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`,
  );
}
```
`tests/helpers/factories.ts`:
```ts
import { randomInt, randomUUID } from "node:crypto";
import { encryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import {
  automations,
  commentEvents,
  igAccounts,
  subscriptions,
  user,
  type Automation,
  type IgAccount,
  type NewAutomation,
  type NewCommentEvent,
} from "@/server/db/schema";

export async function createUser(overrides: Partial<typeof user.$inferInsert> = {}) {
  const id = overrides.id ?? randomUUID();
  const [row] = await getDb()
    .insert(user)
    .values({ id, name: "테스터", email: `${id}@test.local`, ...overrides })
    .returning();
  return row;
}

export function randomIgId(): string {
  return `1784${String(randomInt(10 ** 12)).padStart(13, "0")}`;
}

export async function createIgAccount(
  userId: string,
  overrides: Partial<typeof igAccounts.$inferInsert> = {},
): Promise<IgAccount> {
  const igUserId = overrides.igUserId ?? randomIgId();
  const [row] = await getDb()
    .insert(igAccounts)
    .values({
      userId,
      igUserId,
      igScopedId: `scoped-${igUserId}`,
      username: `creator_${igUserId.slice(-6)}`,
      accountType: "BUSINESS",
      accessTokenEnc: encryptSecret(`token-${igUserId}`),
      tokenExpiresAt: new Date(Date.now() + 50 * 86_400_000),
      ...overrides,
    })
    .returning();
  return row;
}

export async function createAutomation(
  account: IgAccount,
  overrides: Partial<NewAutomation> = {},
): Promise<Automation> {
  const [row] = await getDb()
    .insert(automations)
    .values({
      userId: account.userId,
      igAccountId: account.id,
      name: "공구 자동화",
      mediaScope: "all",
      keywords: ["공구"],
      matchType: "contains",
      replyEnabled: true,
      replyTexts: ["{username} DM 확인해주세요!"],
      dmText: "구매 링크 보내드려요",
      dmButtonTitle: "구매하기",
      dmLinkUrl: "https://shop.example.com/p/1",
      isActive: true,
      ...overrides,
    })
    .returning();
  return row;
}

export async function createEvent(account: IgAccount, overrides: Partial<NewCommentEvent> = {}) {
  const [row] = await getDb()
    .insert(commentEvents)
    .values({
      igAccountId: account.id,
      commentId: randomIgId(),
      mediaId: "media-1",
      commenterIgId: "commenter-1",
      commenterUsername: "follower1",
      commentText: "공구",
      ...overrides,
    })
    .returning();
  return row;
}

export async function setPlan(
  userId: string,
  plan: "free" | "pro" | "agency",
  overrides: Partial<typeof subscriptions.$inferInsert> = {},
) {
  const [row] = await getDb()
    .insert(subscriptions)
    .values({ userId, plan, status: "active", ...overrides })
    .onConflictDoUpdate({ target: subscriptions.userId, set: { plan, status: "active", ...overrides } })
    .returning();
  return row;
}
```

- [ ] **Step 6: 실패하는 스키마 스모크 테스트 (`tests/integration/schema.test.ts`)**

```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { commentEvents, igAccounts } from "@/server/db/schema";
import { resetDb } from "../helpers/db";
import { createAutomation, createEvent, createIgAccount, createUser } from "../helpers/factories";

describe("schema", () => {
  beforeEach(resetDb);

  it("stores accounts, automations and events with defaults", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const auto = await createAutomation(acct);
    const ev = await createEvent(acct);
    expect(acct.status).toBe("active");
    expect(acct.dmFormat).toBe("button");
    expect(auto.keywords).toEqual(["공구"]);
    expect(ev.status).toBe("pending");
    expect(ev.attempts).toBe(0);
  });

  it("enforces unique comment_id", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createEvent(acct, { commentId: "c-1" });
    const again = await getDb()
      .insert(commentEvents)
      .values({ igAccountId: acct.id, commentId: "c-1", mediaId: "m", commenterIgId: "x" })
      .onConflictDoNothing({ target: commentEvents.commentId })
      .returning();
    expect(again).toHaveLength(0);
  });

  it("cascades account deletion to events", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createEvent(acct);
    await getDb().delete(igAccounts).where(eq(igAccounts.id, acct.id));
    expect(await getDb().select().from(commentEvents)).toHaveLength(0);
  });
});
```

- [ ] **Step 7: 통과 확인**

Run: `pnpm test:int`
Expected: PASS (3 tests). DB 연결 실패 시 `pnpm db:up` 후 재실행.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add database schema, migrations and integration test harness"
```

---
### Task 4: 키워드 매칭과 메시지 렌더링

**Files:**
- Create: `src/server/automations/matcher.ts`, `src/server/automations/render.ts`
- Test: `tests/unit/matcher.test.ts`, `tests/unit/render.test.ts`

**Interfaces:**
- Consumes: `site` (Task 1)
- Produces:
  - `normalizeText(input: string): string`
  - `type MatchType = "contains" | "exact" | "any"` (`any` = 키워드 없이 모든 댓글)
  - `matchesKeywords(comment: string, keywords: string[], matchType: MatchType): boolean`
  - `interface RuleLike { id: string; mediaScope: "specific" | "all" | "next"; mediaId: string | null; keywords: string[]; matchType: MatchType; createdAt: Date }`
  - `rulesToBind(rules: RuleLike[], mediaPublishedAt: Date | null): string[]`
  - `selectAutomation<T extends RuleLike>(rules: T[], mediaId: string, commentText: string): T | null`
  - `renderReply(template: string, username: string | null): string`
  - `truncateChars(text: string, max: number): string`
  - `truncateUtf8(text: string, maxBytes: number): string`
  - `buildTextFallback(text: string, buttonTitle: string, url: string): string`
  - `brandingLine(): string`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/unit/matcher.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { matchesKeywords, normalizeText, rulesToBind, selectAutomation, type RuleLike } from "@/server/automations/matcher";

describe("normalizeText", () => {
  it("applies NFKC, lowercases and collapses whitespace", () => {
    expect(normalizeText("  ＬＩＮＫ\n\n주세요  ")).toBe("link 주세요");
  });
});

describe("matchesKeywords", () => {
  it("contains: matches keyword inside longer comment", () => {
    expect(matchesKeywords("공구요!! 저도요", ["공구"], "contains")).toBe(true);
    expect(matchesKeywords("@친구 공구", ["공구"], "contains")).toBe(true);
  });
  it("contains: is case and width insensitive", () => {
    expect(matchesKeywords("ＬＩＮＫ please", ["link"], "contains")).toBe(true);
    expect(matchesKeywords("Link", ["LINK"], "contains")).toBe(true);
  });
  it("exact: ignores trailing punctuation and emoji", () => {
    expect(matchesKeywords("공구🙏", ["공구"], "exact")).toBe(true);
    expect(matchesKeywords("공구!!", ["공구"], "exact")).toBe(true);
    expect(matchesKeywords(" 공구 ", ["공구"], "exact")).toBe(true);
    expect(matchesKeywords("❤️공구❤️", ["공구"], "exact")).toBe(true);
  });
  it("exact: rejects extra words", () => {
    expect(matchesKeywords("공구 주세요", ["공구"], "exact")).toBe(false);
    expect(matchesKeywords("@친구 공구", ["공구"], "exact")).toBe(false);
  });
  it("any of several keywords matches", () => {
    expect(matchesKeywords("링크", ["공구", "링크"], "exact")).toBe(true);
  });
  it("empty or blank keywords never match", () => {
    expect(matchesKeywords("아무거나", [], "contains")).toBe(false);
    expect(matchesKeywords("아무거나", ["  "], "contains")).toBe(false);
  });
  it("any: matches every comment regardless of keywords", () => {
    expect(matchesKeywords("예뻐요", [], "any")).toBe(true);
    expect(matchesKeywords("", [], "any")).toBe(true);
    expect(matchesKeywords("아무 말", ["공구"], "any")).toBe(true);
  });
});

const rule = (o: Partial<RuleLike> & { id: string }): RuleLike => ({
  mediaScope: "all",
  mediaId: null,
  keywords: ["공구"],
  matchType: "contains",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  ...o,
});

describe("selectAutomation", () => {
  it("prefers a specific-media rule over an all-media rule", () => {
    const rules = [
      rule({ id: "all", createdAt: new Date("2026-09-10T00:00:00Z") }),
      rule({ id: "specific", mediaScope: "specific", mediaId: "m1" }),
    ];
    expect(selectAutomation(rules, "m1", "공구")?.id).toBe("specific");
  });
  it("ignores specific rules for other media", () => {
    const rules = [rule({ id: "specific", mediaScope: "specific", mediaId: "m2" })];
    expect(selectAutomation(rules, "m1", "공구")).toBeNull();
  });
  it("picks the newest rule within the same scope", () => {
    const rules = [
      rule({ id: "old", createdAt: new Date("2026-09-01T00:00:00Z") }),
      rule({ id: "new", createdAt: new Date("2026-09-05T00:00:00Z") }),
    ];
    expect(selectAutomation(rules, "m1", "공구")?.id).toBe("new");
  });
  it("falls through to a rule whose keywords match", () => {
    const rules = [
      rule({ id: "specific", mediaScope: "specific", mediaId: "m1", keywords: ["링크"] }),
      rule({ id: "all", keywords: ["공구"] }),
    ];
    expect(selectAutomation(rules, "m1", "공구")?.id).toBe("all");
  });
  it("never selects an unbound next rule", () => {
    expect(selectAutomation([rule({ id: "next", mediaScope: "next" })], "m1", "공구")).toBeNull();
  });
  it("prefers keyword rules over newer 'any' rules within the same scope", () => {
    const rules = [
      rule({ id: "any", matchType: "any", keywords: [], createdAt: new Date("2026-09-20T00:00:00Z") }),
      rule({ id: "kw", keywords: ["공구"], createdAt: new Date("2026-09-01T00:00:00Z") }),
    ];
    expect(selectAutomation(rules, "m1", "공구요")?.id).toBe("kw");
    expect(selectAutomation(rules, "m1", "예뻐요")?.id).toBe("any");
  });
  it("prefers a specific-media 'any' rule over an all-media keyword rule", () => {
    const rules = [
      rule({ id: "all-kw", keywords: ["공구"] }),
      rule({ id: "specific-any", mediaScope: "specific", mediaId: "m1", matchType: "any", keywords: [] }),
    ];
    expect(selectAutomation(rules, "m1", "공구")?.id).toBe("specific-any");
  });
});

describe("rulesToBind", () => {
  it("binds unbound next rules created before the media was published", () => {
    const rules = [
      rule({ id: "before", mediaScope: "next", createdAt: new Date("2026-09-01T00:00:00Z") }),
      rule({ id: "after", mediaScope: "next", createdAt: new Date("2026-09-20T00:00:00Z") }),
      rule({ id: "bound", mediaScope: "next", mediaId: "x" }),
    ];
    expect(rulesToBind(rules, new Date("2026-09-10T00:00:00Z"))).toEqual(["before"]);
  });
  it("binds nothing without a publish time", () => {
    expect(rulesToBind([rule({ id: "n", mediaScope: "next" })], null)).toEqual([]);
  });
});
```

`tests/unit/render.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { brandingLine, buildTextFallback, renderReply, truncateChars, truncateUtf8 } from "@/server/automations/render";

describe("renderReply", () => {
  it("replaces {username} with an @mention", () => {
    expect(renderReply("{username} DM 확인해주세요!", "follower1")).toBe("@follower1 DM 확인해주세요!");
  });
  it("drops the placeholder when username is unknown", () => {
    expect(renderReply("{username} DM 확인해주세요!", null)).toBe("DM 확인해주세요!");
  });
});

describe("truncation", () => {
  it("truncateChars counts code points", () => {
    expect(truncateChars("가나다라", 3)).toBe("가나다");
    expect(truncateChars("🙂🙂🙂", 2)).toBe("🙂🙂");
  });
  it("truncateUtf8 keeps result within byte budget", () => {
    const out = truncateUtf8("가".repeat(500), 100);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(100);
    expect(out.endsWith("...")).toBe(true);
  });
  it("truncateUtf8 leaves short text alone", () => {
    expect(truncateUtf8("짧다", 100)).toBe("짧다");
  });
});

describe("buildTextFallback", () => {
  it("appends the link line and stays within 1000 bytes", () => {
    const out = buildTextFallback("가".repeat(600), "구매하기", "https://example.com/l/abc1234");
    expect(out.endsWith("\n\n구매하기: https://example.com/l/abc1234")).toBe(true);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(1000);
  });
});

describe("brandingLine", () => {
  it("mentions the service name", () => {
    expect(brandingLine()).toContain("리치업");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --project unit tests/unit/matcher.test.ts tests/unit/render.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `src/server/automations/matcher.ts` 구현**

```ts
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
const EDGE_NOISE = /^[\s\p{P}\p{S}‍️]+|[\s\p{P}\p{S}‍️]+$/gu;

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
```

- [ ] **Step 4: `src/server/automations/render.ts` 구현**

```ts
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

export function brandingLine(): string {
  return `— ${site.name} 자동 발송`;
}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm vitest run --project unit tests/unit/matcher.test.ts tests/unit/render.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/automations tests/unit/matcher.test.ts tests/unit/render.test.ts
git commit -m "feat: add keyword matching, scope selection and message rendering"
```

---

### Task 5: Instagram 웹훅 서명·파싱, signed_request, 오류 분류

**Files:**
- Create: `src/server/instagram/webhook.ts`, `src/server/instagram/signed-request.ts`, `src/server/instagram/errors.ts`
- Test: `tests/unit/ig-webhook.test.ts`, `tests/unit/ig-errors.test.ts`

**Interfaces:**
- Consumes: `parseJsonWithStringIds` (Task 2)
- Produces:
  - `verifyHubSignature(rawBody: string, header: string | null, secrets: (string | undefined)[]): boolean`
  - `interface ParsedComment { igUserId; commentId; mediaId; mediaProductType: string | null; parentCommentId: string | null; commenterIgId; commenterUsername: string | null; text }`
  - `parseCommentWebhook(rawBody: string): ParsedComment[]`
  - `parseSignedRequest(signedRequest: string, secrets: (string | undefined)[]): { userId: string } | null`
  - `class GraphApiError(message, httpStatus, code?, subcode?)`
  - `class GraphNetworkError`
  - `type ErrorClass = "rate_limited" | "transient" | "auth" | "invalid_message" | "permanent"`
  - `classifyError(err: unknown): { cls: ErrorClass; code: string; message: string }`
  - `errorReasonKo(code: string | null): string`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/unit/ig-webhook.test.ts`:
```ts
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSignedRequest } from "@/server/instagram/signed-request";
import { parseCommentWebhook, verifyHubSignature } from "@/server/instagram/webhook";

const sign = (body: string, secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifyHubSignature", () => {
  const body = '{"object":"instagram"}';
  it("accepts a signature from any configured secret", () => {
    expect(verifyHubSignature(body, sign(body, "ig"), ["ig", "meta"])).toBe(true);
    expect(verifyHubSignature(body, sign(body, "meta"), ["ig", "meta"])).toBe(true);
  });
  it("rejects wrong, missing or malformed signatures", () => {
    expect(verifyHubSignature(body, sign(body, "other"), ["ig"])).toBe(false);
    expect(verifyHubSignature(body, null, ["ig"])).toBe(false);
    expect(verifyHubSignature(body, "sha1=abc", ["ig"])).toBe(false);
    expect(verifyHubSignature(body, "sha256=zz", ["ig"])).toBe(false);
  });
  it("ignores empty secrets", () => {
    expect(verifyHubSignature(body, sign(body, ""), ["", undefined])).toBe(false);
  });
});

describe("parseCommentWebhook", () => {
  it("parses the changes[] shape with a large entry id", () => {
    const raw = `{"object":"instagram","entry":[{"id":17841400000000001,"time":1758700000,"changes":[{"field":"comments","value":{"from":{"id":"111","username":"follower1"},"media":{"id":"m1","media_product_type":"REELS"},"id":"c1","parent_id":"p1","text":"공구"}}]}]}`;
    expect(parseCommentWebhook(raw)).toEqual([
      {
        igUserId: "17841400000000001",
        commentId: "c1",
        mediaId: "m1",
        mediaProductType: "REELS",
        parentCommentId: "p1",
        commenterIgId: "111",
        commenterUsername: "follower1",
        text: "공구",
      },
    ]);
  });
  it("parses the flat field/value shape and comment_id", () => {
    const raw = JSON.stringify({
      object: "instagram",
      entry: [{ id: "ig1", field: "comments", value: { from: { id: "u" }, media: { id: "m" }, comment_id: "c9", text: "링크" } }],
    });
    const [c] = parseCommentWebhook(raw);
    expect(c.commentId).toBe("c9");
    expect(c.commenterUsername).toBeNull();
    expect(c.parentCommentId).toBeNull();
  });
  it("skips non-comment fields, malformed values and invalid JSON", () => {
    const raw = JSON.stringify({
      object: "instagram",
      entry: [
        { id: "ig1", changes: [{ field: "mentions", value: {} }, { field: "comments", value: { text: "no ids" } }] },
        { id: "ig1", messaging: [{ sender: { id: "s" } }] },
      ],
    });
    expect(parseCommentWebhook(raw)).toEqual([]);
    expect(parseCommentWebhook("not json")).toEqual([]);
  });
});

describe("parseSignedRequest", () => {
  const make = (payload: object, secret: string) => {
    const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const s = createHmac("sha256", secret).update(p).digest("base64url");
    return `${s}.${p}`;
  };
  it("returns the user id for a valid request", () => {
    expect(parseSignedRequest(make({ algorithm: "HMAC-SHA256", user_id: "218471" }, "ig"), ["ig"])).toEqual({
      userId: "218471",
    });
  });
  it("accepts the second secret", () => {
    expect(parseSignedRequest(make({ algorithm: "HMAC-SHA256", user_id: 5 }, "meta"), ["ig", "meta"])?.userId).toBe("5");
  });
  it("rejects bad signatures and missing user ids", () => {
    expect(parseSignedRequest(make({ user_id: "1" }, "x"), ["ig"])).toBeNull();
    expect(parseSignedRequest(make({ algorithm: "HMAC-SHA256" }, "ig"), ["ig"])).toBeNull();
    expect(parseSignedRequest("garbage", ["ig"])).toBeNull();
  });
});
```

`tests/unit/ig-errors.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { classifyError, errorReasonKo, GraphApiError, GraphNetworkError } from "@/server/instagram/errors";

const err = (status: number, code?: number, subcode?: number) => new GraphApiError("x", status, code, subcode);

describe("classifyError", () => {
  it.each([
    [err(400, 613, 2534040), "rate_limited", "613/2534040"],
    [err(400, 4), "rate_limited", "4"],
    [err(429), "rate_limited", "http_429"],
    [err(500, 2), "transient", "2"],
    [err(503), "transient", "http_503"],
    [err(400, 190), "auth", "190"],
    [err(400, 100, 2534015), "invalid_message", "100/2534015"],
    [err(400, 10, 2534022), "permanent", "10/2534022"],
    [err(400, 551), "permanent", "551"],
    [err(400, 200, 2534041), "permanent", "200/2534041"],
  ])("classifies %o as %s", (e, cls, code) => {
    expect(classifyError(e)).toMatchObject({ cls, code });
  });
  it("treats network and unknown errors as transient", () => {
    expect(classifyError(new GraphNetworkError("timeout")).cls).toBe("transient");
    expect(classifyError(new Error("boom")).cls).toBe("transient");
  });
});

describe("errorReasonKo", () => {
  it("maps known codes to Korean reasons", () => {
    expect(errorReasonKo("551")).toContain("메시지를 받을 수 없어요");
    expect(errorReasonKo("613/2534040")).toContain("한도");
    expect(errorReasonKo("190")).toContain("다시 연결");
    expect(errorReasonKo(null)).toBe("");
    expect(errorReasonKo("999")).toBe("인스타그램 오류 (999)");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --project unit tests/unit/ig-webhook.test.ts tests/unit/ig-errors.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `src/server/instagram/webhook.ts` 구현**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { parseJsonWithStringIds } from "./json";

export function verifyHubSignature(
  rawBody: string,
  header: string | null,
  secrets: (string | undefined)[],
): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const hex = header.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
  const given = Buffer.from(hex, "hex");
  return secrets.some((secret) => {
    if (!secret) return false;
    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
    return timingSafeEqual(expected, given);
  });
}

export interface ParsedComment {
  igUserId: string;
  commentId: string;
  mediaId: string;
  mediaProductType: string | null;
  parentCommentId: string | null;
  commenterIgId: string;
  commenterUsername: string | null;
  text: string;
}

const id = z.union([z.string(), z.number()]).transform(String);

const commentValue = z.object({
  id: id.optional(),
  comment_id: id.optional(),
  text: z.string().default(""),
  parent_id: id.optional(),
  from: z.object({ id, username: z.string().optional() }),
  media: z.object({ id, media_product_type: z.string().optional() }),
});

const entrySchema = z.object({
  id,
  changes: z.array(z.object({ field: z.string(), value: z.unknown() })).optional(),
  field: z.string().optional(),
  value: z.unknown().optional(),
});

const payloadSchema = z.object({ entry: z.array(z.unknown()).default([]) });

export function parseCommentWebhook(rawBody: string): ParsedComment[] {
  let json: unknown;
  try {
    json = parseJsonWithStringIds(rawBody);
  } catch {
    return [];
  }
  const payload = payloadSchema.safeParse(json);
  if (!payload.success) return [];

  const out: ParsedComment[] = [];
  for (const rawEntry of payload.data.entry) {
    const entry = entrySchema.safeParse(rawEntry);
    if (!entry.success) continue;
    const changes =
      entry.data.changes ?? (entry.data.field ? [{ field: entry.data.field, value: entry.data.value }] : []);
    for (const change of changes) {
      if (change.field !== "comments") continue;
      const value = commentValue.safeParse(change.value);
      if (!value.success) continue;
      const commentId = value.data.id ?? value.data.comment_id;
      if (!commentId) continue;
      out.push({
        igUserId: entry.data.id,
        commentId,
        mediaId: value.data.media.id,
        mediaProductType: value.data.media.media_product_type ?? null,
        parentCommentId: value.data.parent_id ?? null,
        commenterIgId: value.data.from.id,
        commenterUsername: value.data.from.username ?? null,
        text: value.data.text,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: `src/server/instagram/signed-request.ts` 구현**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { parseJsonWithStringIds } from "./json";

export function parseSignedRequest(
  signedRequest: string,
  secrets: (string | undefined)[],
): { userId: string } | null {
  const [sigPart, payloadPart] = signedRequest.split(".");
  if (!sigPart || !payloadPart) return null;
  const given = Buffer.from(sigPart, "base64url");
  const valid = secrets.some((secret) => {
    if (!secret) return false;
    const expected = createHmac("sha256", secret).update(payloadPart).digest();
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
  if (!valid) return null;
  try {
    const data = parseJsonWithStringIds(Buffer.from(payloadPart, "base64url").toString("utf8")) as {
      algorithm?: string;
      user_id?: string | number;
    };
    if (data.algorithm && data.algorithm.toUpperCase() !== "HMAC-SHA256") return null;
    if (data.user_id === undefined || data.user_id === null) return null;
    return { userId: String(data.user_id) };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: `src/server/instagram/errors.ts` 구현**

```ts
export class GraphApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code?: number,
    readonly subcode?: number,
  ) {
    super(message);
    this.name = "GraphApiError";
  }
}

export class GraphNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphNetworkError";
  }
}

export type ErrorClass = "rate_limited" | "transient" | "auth" | "invalid_message" | "permanent";

export interface ClassifiedError {
  cls: ErrorClass;
  code: string;
  message: string;
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80002]);

export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof GraphApiError) {
    const code =
      err.code === undefined ? `http_${err.httpStatus}` : err.subcode ? `${err.code}/${err.subcode}` : String(err.code);
    const message = err.message;
    if ((err.code !== undefined && RATE_LIMIT_CODES.has(err.code)) || err.httpStatus === 429) {
      return { cls: "rate_limited", code, message };
    }
    if (err.code === 190) return { cls: "auth", code, message };
    if (err.code === 100 && err.subcode === 2534015) return { cls: "invalid_message", code, message };
    if (err.httpStatus >= 500 || err.code === 1 || err.code === 2) return { cls: "transient", code, message };
    return { cls: "permanent", code, message };
  }
  if (err instanceof GraphNetworkError) return { cls: "transient", code: "network", message: err.message };
  return { cls: "transient", code: "unknown", message: err instanceof Error ? err.message : String(err) };
}

const REASONS: Record<string, string> = {
  "10/2534022": "발송 가능 시간이 지났어요 (댓글 후 7일)",
  "10/2018278": "발송 가능 시간이 지났어요",
  "100/2534025": "이미 답장했거나 삭제된 댓글이에요",
  "100/2534014": "댓글 작성자를 찾을 수 없어요",
  "100/2534015": "메시지 형식이 거부됐어요",
  "551": "상대방이 지금 메시지를 받을 수 없어요",
  "551/1545041": "상대방이 지금 메시지를 받을 수 없어요",
  "200/2534041": "인스타 계정에서 DM 접근이 꺼져 있어요",
  "190": "인스타 연결이 만료됐어요. 다시 연결해주세요",
  network: "일시적인 네트워크 오류",
  expired: "7일 안에 발송하지 못했어요",
};

export function errorReasonKo(code: string | null): string {
  if (!code) return "";
  const known = REASONS[code];
  if (known) return known;
  const base = code.split("/")[0];
  if (["4", "17", "32", "613", "80002", "http_429"].includes(base)) {
    return "인스타그램 발송 한도에 걸려 잠시 후 재시도해요";
  }
  if (base === "10" || base === "200") return "권한이 부족해요. 인스타 연결을 확인해주세요";
  return `인스타그램 오류 (${code})`;
}
```

- [ ] **Step 6: 통과 확인**

Run: `pnpm vitest run --project unit tests/unit/ig-webhook.test.ts tests/unit/ig-errors.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/instagram tests/unit/ig-webhook.test.ts tests/unit/ig-errors.test.ts
git commit -m "feat: add Instagram webhook verification, parsing and error classification"
```

---

### Task 6: Graph API 클라이언트와 OAuth

**Files:**
- Create: `src/server/instagram/graph.ts`, `src/server/instagram/oauth.ts`, `tests/helpers/fake-graph.ts`
- Test: `tests/unit/graph.test.ts`, `tests/unit/oauth.test.ts`

**Interfaces:**
- Consumes: `GraphApiError`, `GraphNetworkError`, `parseJsonWithStringIds`
- Produces:
  - `interface IgProfile { id; userId; username; accountType; profilePictureUrl: string | null }`
  - `interface MediaInfo { id; caption; mediaType; mediaProductType; thumbnailUrl; mediaUrl; permalink: string | null; timestamp: Date | null }`
  - `type PrivateReplyMessage = { kind: "button"; text; buttonTitle; url } | { kind: "text"; text }`
  - `interface GraphClient { getMe; subscribeApp; refreshToken; listMedia; getMedia; replyToComment; sendPrivateReply }` — 시그니처는 Step 3 코드 기준
  - `createGraphClient(opts: { version: string; fetchFn?: typeof fetch; timeoutMs?: number }): GraphClient`
  - `IG_SCOPES`, `buildAuthorizeUrl({ appId, redirectUri, state }): string`
  - `exchangeCodeForToken({ appId, appSecret, redirectUri, code, fetchFn? }): Promise<{ accessToken; userId; permissions: string[] }>`
  - `exchangeForLongLivedToken({ appSecret, shortToken, fetchFn? }): Promise<{ accessToken; expiresIn: number }>`
  - 테스트용 `FakeGraphClient` (tests/helpers)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/unit/graph.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { GraphApiError, GraphNetworkError } from "@/server/instagram/errors";
import { createGraphClient } from "@/server/instagram/graph";

function mockFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
}

describe("createGraphClient", () => {
  it("getMe reads id and user_id as strings (flat or wrapped)", async () => {
    const f = mockFetch(200, '{"data":[{"id":17841400000000009,"user_id":17841400000000001,"username":"creator","account_type":"MEDIA_CREATOR"}]}');
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    await expect(client.getMe("tok")).resolves.toEqual({
      id: "17841400000000009",
      userId: "17841400000000001",
      username: "creator",
      accountType: "MEDIA_CREATOR",
      profilePictureUrl: null,
    });
    const url = new URL(String(f.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://graph.instagram.com/v26.0/me");
    expect(url.searchParams.get("access_token")).toBe("tok");
  });

  it("replyToComment posts the message and returns the reply id", async () => {
    const f = mockFetch(200, { id: "17873440459141029" });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    await expect(client.replyToComment("tok", "c1", "@a DM 확인!")).resolves.toEqual({ id: "17873440459141029" });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain("/v26.0/c1/replies");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ message: "@a DM 확인!" });
  });

  it("sendPrivateReply builds a button template body with bearer auth", async () => {
    const f = mockFetch(200, { recipient_id: "5261234567890123456", message_id: "mid.1" });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    await expect(
      client.sendPrivateReply("tok", "ig1", "c1", { kind: "button", text: "링크", buttonTitle: "구매", url: "https://x.y" }),
    ).resolves.toEqual({ messageId: "mid.1" });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe("https://graph.instagram.com/v26.0/ig1/messages");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init?.body))).toEqual({
      recipient: { comment_id: "c1" },
      message: {
        attachment: {
          type: "template",
          payload: { template_type: "button", text: "링크", buttons: [{ type: "web_url", url: "https://x.y", title: "구매" }] },
        },
      },
    });
  });

  it("sendPrivateReply builds a text body", async () => {
    const f = mockFetch(200, { message_id: "mid.2" });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    await client.sendPrivateReply("tok", "ig1", "c1", { kind: "text", text: "hello" });
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ recipient: { comment_id: "c1" }, message: { text: "hello" } });
  });

  it("maps Graph error payloads to GraphApiError with code and subcode", async () => {
    const f = mockFetch(400, { error: { message: "limit", code: 613, error_subcode: 2534040 } });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    const e = await client.replyToComment("tok", "c1", "x").catch((x) => x);
    expect(e).toBeInstanceOf(GraphApiError);
    expect(e).toMatchObject({ httpStatus: 400, code: 613, subcode: 2534040 });
  });

  it("maps fetch failures to GraphNetworkError", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    await expect(client.getMe("tok")).rejects.toBeInstanceOf(GraphNetworkError);
  });

  it("listMedia parses items, timestamps and the next cursor", async () => {
    const f = mockFetch(200, {
      data: [{ id: "m1", caption: "공구 오픈", media_type: "VIDEO", thumbnail_url: "https://t", permalink: "https://p", timestamp: "2026-09-20T12:34:56+0000" }],
      paging: { cursors: { after: "CUR" }, next: "https://next" },
    });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    const res = await client.listMedia("tok", "ig1");
    expect(res.nextCursor).toBe("CUR");
    expect(res.items[0]).toMatchObject({ id: "m1", caption: "공구 오픈", thumbnailUrl: "https://t", mediaProductType: null });
    expect(res.items[0].timestamp?.toISOString()).toBe("2026-09-20T12:34:56.000Z");
  });

  it("refreshToken calls the unversioned refresh endpoint", async () => {
    const f = mockFetch(200, { access_token: "new", token_type: "bearer", expires_in: 5183944 });
    const client = createGraphClient({ version: "v26.0", fetchFn: f });
    await expect(client.refreshToken("old")).resolves.toEqual({ accessToken: "new", expiresIn: 5183944 });
    const url = new URL(String(f.mock.calls[0][0]));
    expect(url.pathname).toBe("/refresh_access_token");
    expect(url.searchParams.get("grant_type")).toBe("ig_refresh_token");
  });
});
```

`tests/unit/oauth.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { GraphApiError } from "@/server/instagram/errors";
import { buildAuthorizeUrl, exchangeCodeForToken, exchangeForLongLivedToken } from "@/server/instagram/oauth";

describe("buildAuthorizeUrl", () => {
  it("includes required params and scopes", () => {
    const u = new URL(buildAuthorizeUrl({ appId: "app", redirectUri: "https://x.y/cb", state: "st" }));
    expect(u.origin + u.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe(
      "instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages",
    );
    expect(u.searchParams.get("state")).toBe("st");
  });
});

describe("exchangeCodeForToken", () => {
  it("parses the wrapped data[] shape and strips #_ from the code", async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) =>
      new Response('{"data":[{"access_token":"short","user_id":17841400000000001,"permissions":"a,b"}]}'),
    );
    const res = await exchangeCodeForToken({ appId: "app", appSecret: "s", redirectUri: "https://x/cb", code: "abc#_", fetchFn: f });
    expect(res).toEqual({ accessToken: "short", userId: "17841400000000001", permissions: ["a", "b"] });
    const body = f.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get("code")).toBe("abc");
    expect(body.get("grant_type")).toBe("authorization_code");
  });

  it("parses the flat shape with a permissions array", async () => {
    const f = vi.fn(async () => new Response('{"access_token":"short","user_id":"42","permissions":["a"]}'));
    await expect(
      exchangeCodeForToken({ appId: "app", appSecret: "s", redirectUri: "r", code: "c", fetchFn: f }),
    ).resolves.toEqual({ accessToken: "short", userId: "42", permissions: ["a"] });
  });

  it("throws GraphApiError on OAuth errors", async () => {
    const f = vi.fn(
      async () =>
        new Response('{"error_type":"OAuthException","code":400,"error_message":"Matching code was not found"}', { status: 400 }),
    );
    await expect(
      exchangeCodeForToken({ appId: "app", appSecret: "s", redirectUri: "r", code: "c", fetchFn: f }),
    ).rejects.toBeInstanceOf(GraphApiError);
  });
});

describe("exchangeForLongLivedToken", () => {
  it("returns token and lifetime", async () => {
    const f = vi.fn(async (_u: string | URL | Request) => new Response('{"access_token":"long","token_type":"bearer","expires_in":5183944}'));
    await expect(exchangeForLongLivedToken({ appSecret: "s", shortToken: "short", fetchFn: f })).resolves.toEqual({
      accessToken: "long",
      expiresIn: 5183944,
    });
    const url = new URL(String(f.mock.calls[0][0]));
    expect(url.searchParams.get("grant_type")).toBe("ig_exchange_token");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --project unit tests/unit/graph.test.ts tests/unit/oauth.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `src/server/instagram/graph.ts` 구현**

```ts
import { GraphApiError, GraphNetworkError } from "./errors";
import { parseJsonWithStringIds } from "./json";

export interface IgProfile {
  id: string;
  userId: string;
  username: string;
  accountType: string;
  profilePictureUrl: string | null;
}

export interface MediaInfo {
  id: string;
  caption: string | null;
  mediaType: string | null;
  mediaProductType: string | null;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  permalink: string | null;
  timestamp: Date | null;
}

export type PrivateReplyMessage =
  | { kind: "button"; text: string; buttonTitle: string; url: string }
  | { kind: "text"; text: string };

export interface GraphClient {
  getMe(token: string): Promise<IgProfile>;
  subscribeApp(token: string, igUserId: string): Promise<void>;
  refreshToken(token: string): Promise<{ accessToken: string; expiresIn: number }>;
  listMedia(token: string, igUserId: string, after?: string): Promise<{ items: MediaInfo[]; nextCursor: string | null }>;
  getMedia(token: string, mediaId: string): Promise<MediaInfo>;
  replyToComment(token: string, commentId: string, message: string): Promise<{ id: string }>;
  sendPrivateReply(
    token: string,
    igUserId: string,
    commentId: string,
    message: PrivateReplyMessage,
  ): Promise<{ messageId: string }>;
}

const MEDIA_FIELDS = "id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp";

type Json = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : null;
}

function parseIgTime(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toMedia(m: Json): MediaInfo {
  return {
    id: str(m.id) ?? "",
    caption: str(m.caption),
    mediaType: str(m.media_type),
    mediaProductType: str(m.media_product_type),
    thumbnailUrl: str(m.thumbnail_url),
    mediaUrl: str(m.media_url),
    permalink: str(m.permalink),
    timestamp: parseIgTime(m.timestamp),
  };
}

function unwrapSingle(j: Json): Json {
  const data = j.data;
  return Array.isArray(data) && data.length === 1 && !("paging" in j) ? (data[0] as Json) : j;
}

export function createGraphClient(opts: {
  version: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): GraphClient {
  const base = `https://graph.instagram.com/${opts.version}`;
  const f = opts.fetchFn ?? fetch;

  async function request(url: string, init: RequestInit): Promise<Json> {
    let res: Response;
    try {
      res = await f(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) });
    } catch (e) {
      throw new GraphNetworkError(e instanceof Error ? e.message : String(e));
    }
    const text = await res.text();
    let json: Json = {};
    try {
      json = text ? (parseJsonWithStringIds(text) as Json) : {};
    } catch {
      json = {};
    }
    const error = json.error as { message?: string; code?: number; error_subcode?: number } | undefined;
    if (!res.ok || error) {
      throw new GraphApiError(error?.message ?? `HTTP ${res.status}`, res.status, error?.code, error?.error_subcode);
    }
    return json;
  }

  const withToken = (path: string, token: string, params: Record<string, string> = {}) => {
    const url = new URL(path.startsWith("http") ? path : `${base}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", token);
    return url.toString();
  };

  return {
    async getMe(token) {
      const j = unwrapSingle(
        await request(withToken("/me", token, { fields: "id,user_id,username,account_type,profile_picture_url" }), {
          method: "GET",
        }),
      );
      return {
        id: str(j.id) ?? "",
        userId: str(j.user_id) ?? str(j.id) ?? "",
        username: str(j.username) ?? "",
        accountType: str(j.account_type) ?? "",
        profilePictureUrl: str(j.profile_picture_url),
      };
    },

    async subscribeApp(token, igUserId) {
      await request(withToken(`/${igUserId}/subscribed_apps`, token, { subscribed_fields: "comments" }), {
        method: "POST",
      });
    },

    async refreshToken(token) {
      const j = await request(
        withToken("https://graph.instagram.com/refresh_access_token", token, { grant_type: "ig_refresh_token" }),
        { method: "GET" },
      );
      return { accessToken: String(j.access_token), expiresIn: Number(j.expires_in) };
    },

    async listMedia(token, igUserId, after) {
      const params: Record<string, string> = { fields: MEDIA_FIELDS, limit: "24" };
      if (after) params.after = after;
      const j = await request(withToken(`/${igUserId}/media`, token, params), { method: "GET" });
      const items = Array.isArray(j.data) ? (j.data as Json[]).map(toMedia) : [];
      const paging = j.paging as { cursors?: { after?: string }; next?: string } | undefined;
      return { items, nextCursor: paging?.next ? (paging.cursors?.after ?? null) : null };
    },

    async getMedia(token, mediaId) {
      return toMedia(await request(withToken(`/${mediaId}`, token, { fields: MEDIA_FIELDS }), { method: "GET" }));
    },

    async replyToComment(token, commentId, message) {
      const j = await request(withToken(`/${commentId}/replies`, token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      return { id: String(j.id) };
    },

    async sendPrivateReply(token, igUserId, commentId, message) {
      const payload =
        message.kind === "button"
          ? {
              attachment: {
                type: "template",
                payload: {
                  template_type: "button",
                  text: message.text,
                  buttons: [{ type: "web_url", url: message.url, title: message.buttonTitle }],
                },
              },
            }
          : { text: message.text };
      const j = await request(`${base}/${igUserId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { comment_id: commentId }, message: payload }),
      });
      return { messageId: String(j.message_id) };
    },
  };
}
```

- [ ] **Step 4: `src/server/instagram/oauth.ts` 구현**

```ts
import { GraphApiError, GraphNetworkError } from "./errors";
import { parseJsonWithStringIds } from "./json";

export const IG_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
] as const;

export function buildAuthorizeUrl(p: { appId: string; redirectUri: string; state: string }): string {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: p.appId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: IG_SCOPES.join(","),
    state: p.state,
  }).toString();
  return url.toString();
}

type Json = Record<string, unknown>;

async function readJson(res: Response): Promise<Json> {
  const text = await res.text();
  try {
    return text ? (parseJsonWithStringIds(text) as Json) : {};
  } catch {
    return {};
  }
}

async function safeFetch(f: typeof fetch, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await f(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    throw new GraphNetworkError(e instanceof Error ? e.message : String(e));
  }
}

function oauthError(res: Response, j: Json): GraphApiError {
  const nested = j.error as { message?: string; code?: number } | undefined;
  const message = (j.error_message as string | undefined) ?? nested?.message ?? `HTTP ${res.status}`;
  const code = typeof j.code === "number" ? j.code : nested?.code;
  return new GraphApiError(message, res.status, code);
}

export async function exchangeCodeForToken(p: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
  fetchFn?: typeof fetch;
}): Promise<{ accessToken: string; userId: string; permissions: string[] }> {
  const body = new URLSearchParams({
    client_id: p.appId,
    client_secret: p.appSecret,
    grant_type: "authorization_code",
    redirect_uri: p.redirectUri,
    code: p.code.replace(/#_$/, ""),
  });
  const res = await safeFetch(p.fetchFn ?? fetch, "https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body,
  });
  const j = await readJson(res);
  if (!res.ok || j.error_type || j.error) throw oauthError(res, j);
  const d = (Array.isArray(j.data) ? j.data[0] : j) as Json;
  const perms = d.permissions;
  const permissions = Array.isArray(perms)
    ? perms.map(String)
    : String(perms ?? "")
        .split(",")
        .filter(Boolean);
  return { accessToken: String(d.access_token), userId: String(d.user_id), permissions };
}

export async function exchangeForLongLivedToken(p: {
  appSecret: string;
  shortToken: string;
  fetchFn?: typeof fetch;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const url = new URL("https://graph.instagram.com/access_token");
  url.search = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: p.appSecret,
    access_token: p.shortToken,
  }).toString();
  const res = await safeFetch(p.fetchFn ?? fetch, url.toString());
  const j = await readJson(res);
  if (!res.ok || j.error) throw oauthError(res, j);
  return { accessToken: String(j.access_token), expiresIn: Number(j.expires_in) };
}
```

- [ ] **Step 5: 테스트용 Fake 클라이언트 (`tests/helpers/fake-graph.ts`)**

```ts
import type { GraphClient, IgProfile, MediaInfo, PrivateReplyMessage } from "@/server/instagram/graph";

export class FakeGraphClient implements GraphClient {
  seq = 0;
  replies: { token: string; commentId: string; message: string }[] = [];
  dms: { token: string; igUserId: string; commentId: string; message: PrivateReplyMessage }[] = [];
  subscribed: string[] = [];
  media: Record<string, MediaInfo> = {};
  profile: IgProfile = { id: "scoped-1", userId: "17841400000000001", username: "creator", accountType: "BUSINESS", profilePictureUrl: null };
  replyError: ((n: number) => unknown) | null = null;
  dmError: ((message: PrivateReplyMessage, n: number) => unknown) | null = null;
  refreshResult: { accessToken: string; expiresIn: number } | Error = { accessToken: "refreshed", expiresIn: 5_184_000 };

  async getMe() {
    return this.profile;
  }
  async subscribeApp(_token: string, igUserId: string) {
    this.subscribed.push(igUserId);
  }
  async refreshToken() {
    if (this.refreshResult instanceof Error) throw this.refreshResult;
    return this.refreshResult;
  }
  async listMedia() {
    return { items: Object.values(this.media), nextCursor: null };
  }
  async getMedia(_token: string, mediaId: string) {
    const m = this.media[mediaId];
    if (!m) throw new Error(`no media ${mediaId}`);
    return m;
  }
  async replyToComment(token: string, commentId: string, message: string) {
    const err = this.replyError?.(this.replies.length);
    if (err) throw err;
    this.replies.push({ token, commentId, message });
    return { id: `reply-${++this.seq}` };
  }
  async sendPrivateReply(token: string, igUserId: string, commentId: string, message: PrivateReplyMessage) {
    const err = this.dmError?.(message, this.dms.length);
    if (err) throw err;
    this.dms.push({ token, igUserId, commentId, message });
    return { messageId: `mid-${++this.seq}` };
  }
}
```

- [ ] **Step 6: 통과 확인**

Run: `pnpm vitest run --project unit tests/unit/graph.test.ts tests/unit/oauth.test.ts && pnpm typecheck`
Expected: PASS, 타입 오류 없음

- [ ] **Step 7: Commit**

```bash
git add src/server/instagram tests/unit/graph.test.ts tests/unit/oauth.test.ts tests/helpers/fake-graph.ts
git commit -m "feat: add Instagram Graph API client and OAuth token exchange"
```

---

### Task 7: 플랜, 월 사용량, 중복 발송 예약

**Files:**
- Create: `src/lib/plans.ts`, `src/server/billing/plan-of.ts`, `src/server/usage.ts`, `src/server/pipeline/deliveries.ts`
- Test: `tests/unit/plans.test.ts`, `tests/integration/usage-deliveries.test.ts`

**Interfaces:**
- Consumes: `Executor`, `usageCounters`, `deliveries`, `subscriptions`
- Produces:
  - `type PlanId`, `interface Plan`, `PLANS`, `PAID_PLAN_IDS`
  - `isUpgrade(from: PlanId, to: PlanId): boolean`
  - `formatKrw(n: number): string`
  - `effectivePlan(sub: { plan: PlanId; status: string } | null | undefined): Plan`
  - `getUserPlan(db: Executor, userId: string): Promise<Plan>`
  - `usagePeriod(now: Date): string`
  - `reserveDm(db, userId, limit, now): Promise<string | null>`
  - `releaseDm(db, userId, period): Promise<void>`
  - `getDmUsage(db, userId, now): Promise<number>`
  - `reserveDelivery(db, { automationId, mediaId, commenterIgId, eventId }): Promise<"reserved" | "duplicate">`
  - `releaseDelivery(db, eventId): Promise<void>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/unit/plans.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { effectivePlan } from "@/server/billing/plan-of";
import { formatKrw, isUpgrade, PLANS } from "@/lib/plans";
import { usagePeriod } from "@/server/usage";

describe("plans", () => {
  it("matches the spec values", () => {
    expect(PLANS.free).toMatchObject({ priceKrw: 0, maxIgAccounts: 1, maxActiveAutomations: 1, monthlyDmLimit: 300, linkTracking: false, branding: true });
    expect(PLANS.pro).toMatchObject({ priceKrw: 9900, maxIgAccounts: 1, maxActiveAutomations: null, monthlyDmLimit: 10000, linkTracking: true, branding: false });
    expect(PLANS.agency).toMatchObject({ priceKrw: 59000, maxIgAccounts: 5, maxActiveAutomations: null, monthlyDmLimit: 50000 });
  });
  it("detects upgrades by price", () => {
    expect(isUpgrade("free", "pro")).toBe(true);
    expect(isUpgrade("pro", "agency")).toBe(true);
    expect(isUpgrade("agency", "pro")).toBe(false);
  });
  it("formats KRW", () => {
    expect(formatKrw(59000)).toBe("59,000원");
  });
});

describe("effectivePlan", () => {
  it("falls back to free without a subscription or when canceled", () => {
    expect(effectivePlan(null).id).toBe("free");
    expect(effectivePlan({ plan: "pro", status: "canceled" }).id).toBe("free");
  });
  it("keeps paid features during past_due grace", () => {
    expect(effectivePlan({ plan: "pro", status: "past_due" }).id).toBe("pro");
  });
});

describe("usagePeriod", () => {
  it("uses the KST calendar month", () => {
    expect(usagePeriod(new Date("2026-09-30T14:59:59Z"))).toBe("2026-09");
    expect(usagePeriod(new Date("2026-09-30T15:00:00Z"))).toBe("2026-10");
  });
});
```

`tests/integration/usage-deliveries.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { reserveDelivery, releaseDelivery } from "@/server/pipeline/deliveries";
import { getDmUsage, releaseDm, reserveDm } from "@/server/usage";
import { resetDb } from "../helpers/db";
import { createAutomation, createEvent, createIgAccount, createUser } from "../helpers/factories";

const now = new Date("2026-09-24T03:00:00Z");

describe("usage counters", () => {
  beforeEach(resetDb);

  it("reserves until the limit then refuses", async () => {
    const u = await createUser();
    expect(await reserveDm(getDb(), u.id, 2, now)).toBe("2026-09");
    expect(await reserveDm(getDb(), u.id, 2, now)).toBe("2026-09");
    expect(await reserveDm(getDb(), u.id, 2, now)).toBeNull();
    expect(await getDmUsage(getDb(), u.id, now)).toBe(2);
  });

  it("releases one reservation and never goes below zero", async () => {
    const u = await createUser();
    await reserveDm(getDb(), u.id, 5, now);
    await releaseDm(getDb(), u.id, "2026-09");
    await releaseDm(getDb(), u.id, "2026-09");
    expect(await getDmUsage(getDb(), u.id, now)).toBe(0);
  });

  it("concurrent reservations never exceed the limit", async () => {
    const u = await createUser();
    const results = await Promise.all(Array.from({ length: 10 }, () => reserveDm(getDb(), u.id, 3, now)));
    expect(results.filter(Boolean)).toHaveLength(3);
  });
});

describe("deliveries", () => {
  beforeEach(resetDb);

  it("reserves once per automation/media/commenter", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const auto = await createAutomation(acct);
    const e1 = await createEvent(acct);
    const e2 = await createEvent(acct);
    const key = { automationId: auto.id, mediaId: "media-1", commenterIgId: "commenter-1" };
    expect(await reserveDelivery(getDb(), { ...key, eventId: e1.id })).toBe("reserved");
    expect(await reserveDelivery(getDb(), { ...key, eventId: e1.id })).toBe("reserved");
    expect(await reserveDelivery(getDb(), { ...key, eventId: e2.id })).toBe("duplicate");
    await releaseDelivery(getDb(), e1.id);
    expect(await reserveDelivery(getDb(), { ...key, eventId: e2.id })).toBe("reserved");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --project unit tests/unit/plans.test.ts; pnpm vitest run --project integration tests/integration/usage-deliveries.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `src/lib/plans.ts` 구현**

```ts
export type PlanId = "free" | "pro" | "agency";

export interface Plan {
  id: PlanId;
  name: string;
  priceKrw: number;
  maxIgAccounts: number;
  maxActiveAutomations: number | null;
  monthlyDmLimit: number;
  linkTracking: boolean;
  branding: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", name: "Free", priceKrw: 0, maxIgAccounts: 1, maxActiveAutomations: 1, monthlyDmLimit: 300, linkTracking: false, branding: true },
  pro: { id: "pro", name: "Pro", priceKrw: 9900, maxIgAccounts: 1, maxActiveAutomations: null, monthlyDmLimit: 10_000, linkTracking: true, branding: false },
  agency: { id: "agency", name: "Agency", priceKrw: 59000, maxIgAccounts: 5, maxActiveAutomations: null, monthlyDmLimit: 50_000, linkTracking: true, branding: false },
};

export const PAID_PLAN_IDS = ["pro", "agency"] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

export function isUpgrade(from: PlanId, to: PlanId): boolean {
  return PLANS[to].priceKrw > PLANS[from].priceKrw;
}

export function formatKrw(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}
```

- [ ] **Step 4: `src/server/billing/plan-of.ts` 구현**

```ts
import { eq } from "drizzle-orm";
import { PLANS, type Plan, type PlanId } from "@/lib/plans";
import type { Executor } from "@/server/db/client";
import { subscriptions } from "@/server/db/schema";

export function effectivePlan(sub: { plan: PlanId; status: string } | null | undefined): Plan {
  if (!sub || sub.status === "canceled") return PLANS.free;
  return PLANS[sub.plan];
}

export async function getUserPlan(db: Executor, userId: string): Promise<Plan> {
  const [sub] = await db
    .select({ plan: subscriptions.plan, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  return effectivePlan(sub);
}
```

- [ ] **Step 5: `src/server/usage.ts` 구현**

```ts
import { and, eq, sql } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import { usageCounters } from "@/server/db/schema";

const KST_OFFSET_MS = 9 * 3_600_000;

export function usagePeriod(now: Date): string {
  const k = new Date(now.getTime() + KST_OFFSET_MS);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 한도 안이면 1건 예약하고 예약한 월을, 초과면 null을 반환한다. */
export async function reserveDm(db: Executor, userId: string, limit: number, now: Date): Promise<string | null> {
  const period = usagePeriod(now);
  const rows = await db
    .insert(usageCounters)
    .values({ userId, period, dmCount: 1 })
    .onConflictDoUpdate({
      target: [usageCounters.userId, usageCounters.period],
      set: { dmCount: sql`${usageCounters.dmCount} + 1` },
      setWhere: sql`${usageCounters.dmCount} < ${limit}`,
    })
    .returning({ dmCount: usageCounters.dmCount });
  return rows.length > 0 ? period : null;
}

export async function releaseDm(db: Executor, userId: string, period: string): Promise<void> {
  await db
    .update(usageCounters)
    .set({ dmCount: sql`greatest(${usageCounters.dmCount} - 1, 0)` })
    .where(and(eq(usageCounters.userId, userId), eq(usageCounters.period, period)));
}

export async function getDmUsage(db: Executor, userId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ dmCount: usageCounters.dmCount })
    .from(usageCounters)
    .where(and(eq(usageCounters.userId, userId), eq(usageCounters.period, usagePeriod(now))));
  return row?.dmCount ?? 0;
}
```

- [ ] **Step 6: `src/server/pipeline/deliveries.ts` 구현**

```ts
import { and, eq } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import { deliveries } from "@/server/db/schema";

export async function reserveDelivery(
  db: Executor,
  key: { automationId: string; mediaId: string; commenterIgId: string; eventId: string },
): Promise<"reserved" | "duplicate"> {
  const inserted = await db
    .insert(deliveries)
    .values(key)
    .onConflictDoNothing({ target: [deliveries.automationId, deliveries.mediaId, deliveries.commenterIgId] })
    .returning({ id: deliveries.id });
  if (inserted.length > 0) return "reserved";
  const [existing] = await db
    .select({ eventId: deliveries.eventId })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.automationId, key.automationId),
        eq(deliveries.mediaId, key.mediaId),
        eq(deliveries.commenterIgId, key.commenterIgId),
      ),
    )
    .limit(1);
  return existing?.eventId === key.eventId ? "reserved" : "duplicate";
}

export async function releaseDelivery(db: Executor, eventId: string): Promise<void> {
  await db.delete(deliveries).where(eq(deliveries.eventId, eventId));
}
```

- [ ] **Step 7: 통과 확인**

Run: `pnpm vitest run --project unit tests/unit/plans.test.ts && pnpm vitest run --project integration tests/integration/usage-deliveries.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/lib/plans.ts src/server/billing/plan-of.ts src/server/usage.ts src/server/pipeline/deliveries.ts tests/unit/plans.test.ts tests/integration/usage-deliveries.test.ts
git commit -m "feat: add plans, monthly DM usage counters and delivery dedupe"
```

---
### Task 8: 계정별 발송 슬롯 예약 (레이트 리밋 + 발송 간격)

**Files:**
- Create: `src/server/ratelimit.ts`
- Test: `tests/integration/ratelimit.test.ts`

**Interfaces:**
- Consumes: `Db`, `igAccounts`, `commentEvents`
- Produces: `reserveSendSlot(db: Db, o: { igAccountId: string; eventId: string; now: Date; hourlyLimit: number; random: () => number }): Promise<Date>`
  - 반환값은 예약된 발송 시각이다.
  - 이벤트의 `dmReservedAt`과 계정의 `nextReplyAt`을 갱신한다.

- [ ] **Step 1: 실패하는 테스트 작성 (`tests/integration/ratelimit.test.ts`)**

```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { commentEvents, igAccounts } from "@/server/db/schema";
import { reserveSendSlot } from "@/server/ratelimit";
import { resetDb } from "../helpers/db";
import { createEvent, createIgAccount, createUser } from "../helpers/factories";

const HOUR = 3_600_000;

async function setup(nextReplyAt: Date) {
  const u = await createUser();
  const acct = await createIgAccount(u.id, { nextReplyAt });
  return acct;
}

describe("reserveSendSlot", () => {
  beforeEach(resetDb);

  it("returns now for an idle account and spaces the next slot by 1-3s", async () => {
    const now = new Date();
    const acct = await setup(new Date(now.getTime() - 60_000));
    const e1 = await createEvent(acct);
    const e2 = await createEvent(acct);
    const s1 = await reserveSendSlot(getDb(), { igAccountId: acct.id, eventId: e1.id, now, hourlyLimit: 700, random: () => 0 });
    const s2 = await reserveSendSlot(getDb(), { igAccountId: acct.id, eventId: e2.id, now, hourlyLimit: 700, random: () => 0.5 });
    expect(s1.getTime()).toBe(now.getTime());
    expect(s2.getTime()).toBe(now.getTime() + 1000);
    const [row] = await getDb().select().from(commentEvents).where(eq(commentEvents.id, e2.id));
    expect(row.dmReservedAt?.getTime()).toBe(s2.getTime());
    const [a] = await getDb().select().from(igAccounts).where(eq(igAccounts.id, acct.id));
    expect(a.nextReplyAt.getTime()).toBe(s2.getTime() + 2000);
  });

  it("pushes the slot past the hourly window when the limit is reached", async () => {
    const now = new Date();
    const acct = await setup(now);
    const events = await Promise.all([1, 2, 3, 4].map(() => createEvent(acct)));
    const slots: Date[] = [];
    for (const e of events) {
      slots.push(await reserveSendSlot(getDb(), { igAccountId: acct.id, eventId: e.id, now, hourlyLimit: 3, random: () => 0 }));
    }
    expect(slots[3].getTime()).toBe(slots[0].getTime() + HOUR);
  });

  it("gives distinct increasing slots under concurrency", async () => {
    const now = new Date();
    const acct = await setup(now);
    const events = await Promise.all(Array.from({ length: 6 }, () => createEvent(acct)));
    const slots = await Promise.all(
      events.map((e) => reserveSendSlot(getDb(), { igAccountId: acct.id, eventId: e.id, now, hourlyLimit: 700, random: () => 0 })),
    );
    const sorted = slots.map((s) => s.getTime()).sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(1000);
  });

  it("keeps accounts independent", async () => {
    const now = new Date();
    const a = await setup(new Date(now.getTime() + 600_000));
    const b = await setup(now);
    const eb = await createEvent(b);
    const slot = await reserveSendSlot(getDb(), { igAccountId: b.id, eventId: eb.id, now, hourlyLimit: 700, random: () => 0 });
    expect(slot.getTime()).toBe(now.getTime());
    expect(a.id).not.toBe(b.id);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --project integration tests/integration/ratelimit.test.ts`
Expected: FAIL — `Cannot find module '@/server/ratelimit'`

- [ ] **Step 3: `src/server/ratelimit.ts` 구현**

```ts
import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { commentEvents, igAccounts } from "@/server/db/schema";

const HOUR = 3_600_000;

/**
 * 계정별로 단조 증가하는 발송 슬롯을 예약한다.
 * - 발송 간격: 이전 슬롯 + 1~3초
 * - 시간당 한도: 최근 1시간 예약 중 hourlyLimit번째(최신순) + 1시간 이후
 */
export async function reserveSendSlot(
  db: Db,
  o: { igAccountId: string; eventId: string; now: Date; hourlyLimit: number; random: () => number },
): Promise<Date> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ig-send:${o.igAccountId}`}))`);

    const [acct] = await tx
      .select({ nextReplyAt: igAccounts.nextReplyAt })
      .from(igAccounts)
      .where(eq(igAccounts.id, o.igAccountId));
    if (!acct) throw new Error(`ig account ${o.igAccountId} not found`);

    let t = Math.max(o.now.getTime(), acct.nextReplyAt.getTime());

    const [kth] = await tx
      .select({ at: commentEvents.dmReservedAt })
      .from(commentEvents)
      .where(
        and(
          eq(commentEvents.igAccountId, o.igAccountId),
          gt(commentEvents.dmReservedAt, new Date(o.now.getTime() - HOUR)),
        ),
      )
      .orderBy(desc(commentEvents.dmReservedAt))
      .offset(o.hourlyLimit - 1)
      .limit(1);
    if (kth?.at) t = Math.max(t, kth.at.getTime() + HOUR);

    const slot = new Date(t);
    const gapMs = 1000 + Math.floor(o.random() * 2000);
    await tx.update(igAccounts).set({ nextReplyAt: new Date(t + gapMs) }).where(eq(igAccounts.id, o.igAccountId));
    await tx.update(commentEvents).set({ dmReservedAt: slot }).where(eq(commentEvents.id, o.eventId));
    return slot;
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run --project integration tests/integration/ratelimit.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/ratelimit.ts tests/integration/ratelimit.test.ts
git commit -m "feat: add per-account send slot reservation with hourly limit"
```

---

### Task 9: 이벤트 큐와 단축 링크

**Files:**
- Create: `src/server/queue/backoff.ts`, `src/server/queue/events.ts`, `src/server/links.ts`
- Test: `tests/unit/backoff-links.test.ts`, `tests/integration/queue.test.ts`, `tests/integration/links.test.ts`

**Interfaces:**
- Consumes: `Db`, `Executor`, `commentEvents`, `links`
- Produces:
  - `MAX_ATTEMPTS = 5`
  - `backoffDelayMs(attempt: number, random: () => number): number`
  - `QUEUE_CHANNEL = "comment_events"`
  - `enqueueComments(db: Executor, rows: NewCommentEvent[]): Promise<number>`
  - `claimEvents(db: Db, o: { batch: number; now: Date }): Promise<CommentEvent[]>`
  - `type EventPatch`
  - `updateEvent(db, id, patch)`
  - `requeueEvent(db, id, runAt: Date, patch?: EventPatch, opts?: { refundAttempt?: boolean })`
  - `finishEvent(db, id, status, patch?, now?)`
  - `generateCode(length?: number): string`
  - `isBotUserAgent(ua: string | null): boolean`
  - `getOrCreateEventLink(db, { eventId, automationId, targetUrl }): Promise<string>`
  - `resolveLinkClick(db, code, { countClick: boolean; now: Date }): Promise<string | null>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/unit/backoff-links.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { generateCode, isBotUserAgent } from "@/server/links";
import { backoffDelayMs } from "@/server/queue/backoff";

describe("backoffDelayMs", () => {
  it("doubles from 30s with ±20% jitter", () => {
    expect(backoffDelayMs(1, () => 0.5)).toBe(30_000);
    expect(backoffDelayMs(3, () => 0.5)).toBe(120_000);
    expect(backoffDelayMs(1, () => 0)).toBe(24_000);
    expect(backoffDelayMs(1, () => 1)).toBe(36_000);
  });
});

describe("links helpers", () => {
  it("generates base62 codes", () => {
    expect(generateCode()).toMatch(/^[0-9A-Za-z]{7}$/);
    expect(new Set(Array.from({ length: 200 }, () => generateCode())).size).toBe(200);
  });
  it("detects link-preview bots", () => {
    expect(isBotUserAgent("facebookexternalhit/1.1")).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (iPhone) Instagram 350.0.0.0")).toBe(false);
    expect(isBotUserAgent("Mozilla/5.0 (Linux; Android 14) KAKAOTALK 10.0")).toBe(false);
  });
});
```

`tests/integration/queue.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { commentEvents } from "@/server/db/schema";
import { claimEvents, enqueueComments, finishEvent, requeueEvent } from "@/server/queue/events";
import { resetDb } from "../helpers/db";
import { createEvent, createIgAccount, createUser } from "../helpers/factories";

describe("queue", () => {
  beforeEach(resetDb);

  it("enqueue is idempotent by comment_id", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const row = { igAccountId: acct.id, commentId: "c-1", mediaId: "m", commenterIgId: "x", commentText: "공구" };
    expect(await enqueueComments(getDb(), [row, { ...row }])).toBe(1);
    expect(await enqueueComments(getDb(), [row])).toBe(0);
    expect(await getDb().select().from(commentEvents)).toHaveLength(1);
  });

  it("claims only due pending events and marks them processing", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const now = new Date();
    const due = await createEvent(acct, { runAt: new Date(now.getTime() - 1000) });
    await createEvent(acct, { runAt: new Date(now.getTime() + 60_000) });
    const claimed = await claimEvents(getDb(), { batch: 10, now });
    expect(claimed.map((e) => e.id)).toEqual([due.id]);
    expect(claimed[0]).toMatchObject({ status: "processing", attempts: 1 });
  });

  it("never hands the same event to two concurrent claimers", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await Promise.all(Array.from({ length: 10 }, () => createEvent(acct, { runAt: new Date(Date.now() - 1000) })));
    const now = new Date();
    const [a, b] = await Promise.all([claimEvents(getDb(), { batch: 6, now }), claimEvents(getDb(), { batch: 6, now })]);
    const ids = [...a, ...b].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(10);
  });

  it("reclaims events stuck in processing for over 5 minutes", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const now = new Date();
    const stuck = await createEvent(acct, { status: "processing", lockedAt: new Date(now.getTime() - 6 * 60_000), attempts: 1 });
    const claimed = await claimEvents(getDb(), { batch: 10, now });
    expect(claimed.map((e) => e.id)).toEqual([stuck.id]);
    expect(claimed[0].attempts).toBe(2);
  });

  it("requeue can refund the attempt and finish records completion", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const ev = await createEvent(acct, { status: "processing", attempts: 2 });
    const runAt = new Date(Date.now() + 300_000);
    await requeueEvent(getDb(), ev.id, runAt, { errorCode: "613" }, { refundAttempt: true });
    let [row] = await getDb().select().from(commentEvents).where(eq(commentEvents.id, ev.id));
    expect(row).toMatchObject({ status: "pending", attempts: 1, errorCode: "613", lockedAt: null });
    expect(row.runAt.getTime()).toBe(runAt.getTime());
    await finishEvent(getDb(), ev.id, "succeeded", { dmStatus: "sent" });
    [row] = await getDb().select().from(commentEvents).where(eq(commentEvents.id, ev.id));
    expect(row.status).toBe("succeeded");
    expect(row.completedAt).not.toBeNull();
  });
});
```

`tests/integration/links.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { links } from "@/server/db/schema";
import { getOrCreateEventLink, resolveLinkClick } from "@/server/links";
import { resetDb } from "../helpers/db";
import { createAutomation, createEvent, createIgAccount, createUser } from "../helpers/factories";

describe("links", () => {
  beforeEach(resetDb);

  it("creates one link per event and counts human clicks only", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const auto = await createAutomation(acct);
    const ev = await createEvent(acct);
    const code = await getOrCreateEventLink(getDb(), { eventId: ev.id, automationId: auto.id, targetUrl: "https://shop.example.com/p/1" });
    expect(await getOrCreateEventLink(getDb(), { eventId: ev.id, automationId: auto.id, targetUrl: "https://other" })).toBe(code);

    const now = new Date();
    expect(await resolveLinkClick(getDb(), code, { countClick: false, now })).toBe("https://shop.example.com/p/1");
    expect(await resolveLinkClick(getDb(), code, { countClick: true, now })).toBe("https://shop.example.com/p/1");
    await resolveLinkClick(getDb(), code, { countClick: true, now: new Date(now.getTime() + 1000) });
    const [row] = await getDb().select().from(links).where(eq(links.code, code));
    expect(row.clickCount).toBe(2);
    expect(row.firstClickedAt?.getTime()).toBe(now.getTime());
  });

  it("returns null for unknown or malformed codes", async () => {
    expect(await resolveLinkClick(getDb(), "Zz9Zz9Z", { countClick: true, now: new Date() })).toBeNull();
    expect(await resolveLinkClick(getDb(), "../etc", { countClick: true, now: new Date() })).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --project unit tests/unit/backoff-links.test.ts; pnpm vitest run --project integration tests/integration/queue.test.ts tests/integration/links.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `src/server/queue/backoff.ts` 구현**

```ts
export const MAX_ATTEMPTS = 5;

/** 30초 × 2^(attempt-1), ±20% 지터 */
export function backoffDelayMs(attempt: number, random: () => number): number {
  const base = 30_000 * 2 ** Math.max(0, attempt - 1);
  const jitter = 0.8 + random() * 0.4;
  return Math.round(base * jitter);
}
```

- [ ] **Step 4: `src/server/queue/events.ts` 구현**

```ts
import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { Db, Executor } from "@/server/db/client";
import { commentEvents, type CommentEvent, type EventStatus, type NewCommentEvent } from "@/server/db/schema";

export const QUEUE_CHANNEL = "comment_events";
const STALE_LOCK_MS = 5 * 60_000;

export type EventPatch = Partial<Omit<NewCommentEvent, "id" | "commentId" | "igAccountId">>;

export async function enqueueComments(db: Executor, rows: NewCommentEvent[]): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(commentEvents)
    .values(rows)
    .onConflictDoNothing({ target: commentEvents.commentId })
    .returning({ id: commentEvents.id });
  if (inserted.length > 0) await db.execute(sql`select pg_notify(${QUEUE_CHANNEL}, '')`);
  return inserted.length;
}

export async function claimEvents(db: Db, o: { batch: number; now: Date }): Promise<CommentEvent[]> {
  if (o.batch <= 0) return [];
  return db.transaction(async (tx) => {
    const staleBefore = new Date(o.now.getTime() - STALE_LOCK_MS);
    const candidates = await tx
      .select({ id: commentEvents.id })
      .from(commentEvents)
      .where(
        or(
          and(eq(commentEvents.status, "pending"), lte(commentEvents.runAt, o.now)),
          and(eq(commentEvents.status, "processing"), lt(commentEvents.lockedAt, staleBefore)),
        ),
      )
      .orderBy(asc(commentEvents.runAt))
      .limit(o.batch)
      .for("update", { skipLocked: true });
    if (candidates.length === 0) return [];
    return tx
      .update(commentEvents)
      .set({ status: "processing", lockedAt: o.now, attempts: sql`${commentEvents.attempts} + 1` })
      .where(
        inArray(
          commentEvents.id,
          candidates.map((c) => c.id),
        ),
      )
      .returning();
  });
}

export async function updateEvent(db: Executor, id: string, patch: EventPatch): Promise<void> {
  await db.update(commentEvents).set(patch).where(eq(commentEvents.id, id));
}

export async function requeueEvent(
  db: Executor,
  id: string,
  runAt: Date,
  patch: EventPatch = {},
  opts: { refundAttempt?: boolean } = {},
): Promise<void> {
  await db
    .update(commentEvents)
    .set({
      ...patch,
      status: "pending",
      runAt,
      lockedAt: null,
      ...(opts.refundAttempt ? { attempts: sql`greatest(${commentEvents.attempts} - 1, 0)` } : {}),
    })
    .where(eq(commentEvents.id, id));
}

export async function finishEvent(
  db: Executor,
  id: string,
  status: Exclude<EventStatus, "pending" | "processing">,
  patch: EventPatch = {},
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(commentEvents)
    .set({ ...patch, status, lockedAt: null, completedAt: now })
    .where(eq(commentEvents.id, id));
}
```

- [ ] **Step 5: `src/server/links.ts` 구현**

```ts
import { randomInt } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import { links } from "@/server/db/schema";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BOT_UA =
  /(facebookexternalhit|facebot|meta-externalagent|bot\b|crawler|spider|preview|slackbot|kakaotalk-scrap|twitterbot|whatsapp|telegrambot|discordbot)/i;

export function generateCode(length = 7): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export function isBotUserAgent(ua: string | null): boolean {
  return !ua || BOT_UA.test(ua);
}

export async function getOrCreateEventLink(
  db: Executor,
  p: { eventId: string; automationId: string; targetUrl: string },
): Promise<string> {
  const [existing] = await db.select({ code: links.code }).from(links).where(eq(links.eventId, p.eventId)).limit(1);
  if (existing) return existing.code;
  for (let i = 0; i < 5; i++) {
    const rows = await db
      .insert(links)
      .values({ code: generateCode(), eventId: p.eventId, automationId: p.automationId, targetUrl: p.targetUrl })
      .onConflictDoNothing({ target: links.code })
      .returning({ code: links.code });
    if (rows[0]) return rows[0].code;
  }
  throw new Error("could not allocate a unique link code");
}

export async function resolveLinkClick(
  db: Executor,
  code: string,
  o: { countClick: boolean; now: Date },
): Promise<string | null> {
  if (!/^[0-9A-Za-z]{4,16}$/.test(code)) return null;
  if (!o.countClick) {
    const [row] = await db.select({ targetUrl: links.targetUrl }).from(links).where(eq(links.code, code)).limit(1);
    return row?.targetUrl ?? null;
  }
  const [row] = await db
    .update(links)
    .set({
      clickCount: sql`${links.clickCount} + 1`,
      firstClickedAt: sql`coalesce(${links.firstClickedAt}, ${o.now.toISOString()}::timestamptz)`,
      lastClickedAt: o.now,
    })
    .where(eq(links.code, code))
    .returning({ targetUrl: links.targetUrl });
  return row?.targetUrl ?? null;
}
```

- [ ] **Step 6: 통과 확인**

Run: `pnpm vitest run --project unit tests/unit/backoff-links.test.ts && pnpm vitest run --project integration tests/integration/queue.test.ts tests/integration/links.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/queue src/server/links.ts tests/unit/backoff-links.test.ts tests/integration/queue.test.ts tests/integration/links.test.ts
git commit -m "feat: add Postgres-backed comment event queue and short links"
```

---

### Task 10: 댓글 처리 파이프라인

**Files:**
- Create: `src/server/pipeline/process-comment.ts`
- Test: `tests/integration/pipeline.test.ts`

**Interfaces:**
- Consumes: 앞선 Task의 모든 도메인 함수
  - `rulesToBind`, `selectAutomation`, `renderReply`, `buildTextFallback`, `brandingLine`, `truncateChars`
  - `getUserPlan`, `reserveDelivery`, `releaseDelivery`, `reserveDm`, `releaseDm`, `reserveSendSlot`
  - `updateEvent`, `requeueEvent`, `finishEvent`, `getOrCreateEventLink`, `classifyError`, `backoffDelayMs`, `MAX_ATTEMPTS`
- Produces:
  - `interface PipelineDeps { db: Db; graph: GraphClient; now(): Date; random(): number; sleep(ms): Promise<void>; appUrl: string; hourlyLimit: number; decryptToken(enc: string): string; onAuthFailure?(account: IgAccount): Promise<void> }`
  - `type ProcessOutcome = "succeeded" | "partial" | "failed" | "skipped" | "expired" | "deferred" | "retry"`
  - `processCommentEvent(deps: PipelineDeps, event: CommentEvent): Promise<ProcessOutcome>` — `event`는 `claimEvents`가 반환한 processing 상태 행

- [ ] **Step 1: 실패하는 테스트 작성 (`tests/integration/pipeline.test.ts`)**

```ts
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { automations, commentEvents, deliveries, igAccounts, links, usageCounters, type IgAccount } from "@/server/db/schema";
import { GraphApiError } from "@/server/instagram/errors";
import { processCommentEvent, type PipelineDeps } from "@/server/pipeline/process-comment";
import { usagePeriod } from "@/server/usage";
import { resetDb } from "../helpers/db";
import { createAutomation, createEvent, createIgAccount, createUser, setPlan } from "../helpers/factories";
import { FakeGraphClient } from "../helpers/fake-graph";

let graph: FakeGraphClient;
let authFailures: IgAccount[];

function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    db: getDb(),
    graph,
    now: () => new Date(),
    random: () => 0,
    sleep: async () => {},
    appUrl: "https://app.test",
    hourlyLimit: 700,
    decryptToken: decryptSecret,
    onAuthFailure: async (a) => {
      authFailures.push(a);
    },
    ...overrides,
  };
}

async function claim(id: string) {
  const [ev] = await getDb()
    .update(commentEvents)
    .set({ status: "processing", lockedAt: new Date(), attempts: sql`${commentEvents.attempts} + 1` })
    .where(eq(commentEvents.id, id))
    .returning();
  return ev;
}

async function eventRow(id: string) {
  const [row] = await getDb().select().from(commentEvents).where(eq(commentEvents.id, id));
  return row;
}

async function world(plan: "free" | "pro" = "free") {
  const u = await createUser();
  if (plan !== "free") await setPlan(u.id, plan);
  const acct = await createIgAccount(u.id, { nextReplyAt: new Date(Date.now() - 60_000) });
  const auto = await createAutomation(acct);
  return { u, acct, auto };
}

describe("processCommentEvent", () => {
  beforeEach(async () => {
    await resetDb();
    graph = new FakeGraphClient();
    authFailures = [];
  });

  it("sends a public reply and a button DM on keyword match (free plan)", async () => {
    const { acct, auto, u } = await world();
    const ev = await createEvent(acct, { commentText: "공구요!!" });
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("succeeded");

    expect(graph.replies).toEqual([{ token: `token-${acct.igUserId}`, commentId: ev.commentId, message: "@follower1 DM 확인해주세요!" }]);
    expect(graph.dms).toHaveLength(1);
    const dm = graph.dms[0];
    expect(dm.igUserId).toBe(acct.igUserId);
    expect(dm.message).toMatchObject({ kind: "button", buttonTitle: "구매하기", url: "https://shop.example.com/p/1" });
    expect(dm.message.text).toContain("구매 링크 보내드려요");
    expect(dm.message.text).toContain("리치업 자동 발송");

    const row = await eventRow(ev.id);
    expect(row).toMatchObject({ status: "succeeded", automationId: auto.id, replyStatus: "sent", dmStatus: "sent", replyCommentId: "reply-1" });
    const [usage] = await getDb().select().from(usageCounters).where(eq(usageCounters.userId, u.id));
    expect(usage.dmCount).toBe(1);
    expect(await getDb().select().from(deliveries)).toHaveLength(1);
  });

  it("wraps the DM link in a tracked short link on pro, without branding", async () => {
    const { acct } = await world("pro");
    const ev = await createEvent(acct);
    await processCommentEvent(deps(), await claim(ev.id));
    const msg = graph.dms[0].message;
    expect(msg.kind).toBe("button");
    if (msg.kind !== "button") throw new Error("unreachable");
    expect(msg.url).toMatch(/^https:\/\/app\.test\/l\/[0-9A-Za-z]{7}$/);
    expect(msg.text).not.toContain("자동 발송");
    const [link] = await getDb().select().from(links);
    expect(link.targetUrl).toBe("https://shop.example.com/p/1");
    expect(link.eventId).toBe(ev.id);
  });

  it("skips comments that match no automation", async () => {
    const { acct } = await world();
    const ev = await createEvent(acct, { commentText: "예뻐요" });
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("skipped");
    expect((await eventRow(ev.id)).skipReason).toBe("no_match");
    expect(graph.replies).toHaveLength(0);
  });

  it.each([
    ["by commenter id", (a: IgAccount) => ({ commenterIgId: a.igUserId })],
    ["by username", (a: IgAccount) => ({ commenterUsername: a.username.toUpperCase() })],
  ])("skips the account's own comments %s", async (_label, patch) => {
    const { acct } = await world();
    const ev = await createEvent(acct, patch(acct));
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("skipped");
    expect((await eventRow(ev.id)).skipReason).toBe("self");
    expect(graph.replies).toHaveLength(0);
  });

  it("skips a webhook for a reply we posted ourselves", async () => {
    const { acct } = await world();
    const first = await createEvent(acct);
    await processCommentEvent(deps(), await claim(first.id));
    const echo = await createEvent(acct, { commentId: "reply-1", commenterIgId: "someone-else", commenterUsername: null, commentText: "@follower1 공구 DM 확인" });
    expect(await processCommentEvent(deps(), await claim(echo.id))).toBe("skipped");
    expect((await eventRow(echo.id)).skipReason).toBe("self");
    expect(graph.replies).toHaveLength(1);
  });

  it("sends only once per commenter, media and automation", async () => {
    const { acct } = await world();
    const e1 = await createEvent(acct);
    const e2 = await createEvent(acct, { commentText: "공구 저도요" });
    await processCommentEvent(deps(), await claim(e1.id));
    expect(await processCommentEvent(deps(), await claim(e2.id))).toBe("skipped");
    expect((await eventRow(e2.id)).skipReason).toBe("duplicate");
    expect(graph.dms).toHaveLength(1);
  });

  it("stops at the monthly DM quota and releases the dedupe reservation", async () => {
    const { acct, u } = await world();
    await getDb().insert(usageCounters).values({ userId: u.id, period: usagePeriod(new Date()), dmCount: 300 });
    const ev = await createEvent(acct);
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("skipped");
    expect((await eventRow(ev.id)).skipReason).toBe("quota");
    expect(await getDb().select().from(deliveries)).toHaveLength(0);
  });

  it("returns a far-future slot to the queue instead of waiting", async () => {
    const { acct } = await world();
    const slot = new Date(Date.now() + 60_000);
    await getDb().update(igAccounts).set({ nextReplyAt: slot }).where(eq(igAccounts.id, acct.id));
    const ev = await createEvent(acct);
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("deferred");
    const row = await eventRow(ev.id);
    expect(row).toMatchObject({ status: "pending", attempts: 0 });
    expect(row.runAt.getTime()).toBe(slot.getTime());
    expect(row.dmReservedAt?.getTime()).toBe(slot.getTime());
    expect(graph.replies).toHaveLength(0);

    await getDb().update(commentEvents).set({ runAt: new Date() }).where(eq(commentEvents.id, ev.id));
    const later = deps({ now: () => new Date(slot.getTime() + 10) });
    expect(await processCommentEvent(later, await claim(ev.id))).toBe("succeeded");
  });

  it("retries a transient DM failure without re-sending the reply", async () => {
    const { acct } = await world();
    let calls = 0;
    graph.dmError = () => (calls++ === 0 ? new GraphApiError("down", 503) : null);
    const ev = await createEvent(acct);
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("retry");
    let row = await eventRow(ev.id);
    expect(row).toMatchObject({ status: "pending", replyStatus: "sent", dmStatus: null, dmReservedAt: null, errorCode: "http_503" });
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now() + 20_000);

    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("succeeded");
    expect(graph.replies).toHaveLength(1);
    expect(graph.dms).toHaveLength(1);
    row = await eventRow(ev.id);
    expect(row.errorCode).toBeNull();
  });

  it("marks partial and releases reservations on a permanent DM error", async () => {
    const { acct, u } = await world();
    graph.dmError = () => new GraphApiError("cannot receive", 400, 551);
    const ev = await createEvent(acct);
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("partial");
    expect(await eventRow(ev.id)).toMatchObject({ replyStatus: "sent", dmStatus: "failed", errorCode: "551" });
    expect(await getDb().select().from(deliveries)).toHaveLength(0);
    const [usage] = await getDb().select().from(usageCounters).where(eq(usageCounters.userId, u.id));
    expect(usage.dmCount).toBe(0);
  });

  it("falls back to a text DM when the button template is rejected and remembers it", async () => {
    const { acct } = await world();
    graph.dmError = (m) => (m.kind === "button" ? new GraphApiError("invalid", 400, 100, 2534015) : null);
    const e1 = await createEvent(acct);
    expect(await processCommentEvent(deps(), await claim(e1.id))).toBe("succeeded");
    expect(graph.dms[0].message.kind).toBe("text");
    expect(graph.dms[0].message.text).toContain("구매하기: https://shop.example.com/p/1");
    const [a] = await getDb().select().from(igAccounts).where(eq(igAccounts.id, acct.id));
    expect(a.dmFormat).toBe("text");
  });

  it("flags the account for reauth on an invalid token and does not DM", async () => {
    const { acct } = await world();
    graph.replyError = () => new GraphApiError("expired", 400, 190);
    const ev = await createEvent(acct);
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("failed");
    expect(graph.dms).toHaveLength(0);
    const [a] = await getDb().select().from(igAccounts).where(eq(igAccounts.id, acct.id));
    expect(a.status).toBe("reauth_required");
    expect(authFailures).toHaveLength(1);
    expect((await eventRow(ev.id)).errorCode).toBe("190");
  });

  it("waits 5 minutes on rate limits without spending an attempt", async () => {
    const { acct } = await world();
    graph.replyError = () => new GraphApiError("limit", 400, 613, 2534040);
    graph.dmError = () => new GraphApiError("limit", 400, 613, 2534040);
    const ev = await createEvent(acct);
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("retry");
    const row = await eventRow(ev.id);
    expect(row.attempts).toBe(0);
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
  });

  it("fails after the last transient attempt", async () => {
    const { acct } = await world();
    graph.replyError = () => new GraphApiError("down", 500);
    graph.dmError = () => new GraphApiError("down", 500);
    const ev = await createEvent(acct, { attempts: 4 });
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("failed");
    expect(await eventRow(ev.id)).toMatchObject({ status: "failed", replyStatus: "failed", dmStatus: "failed" });
  });

  it("expires events older than 7 days without calling Instagram", async () => {
    const { acct } = await world();
    const ev = await createEvent(acct, { receivedAt: new Date(Date.now() - 8 * 86_400_000) });
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("expired");
    expect(graph.replies).toHaveLength(0);
    expect((await eventRow(ev.id)).errorCode).toBe("expired");
  });

  it("binds a 'next post' automation to media published after it was created", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id, { nextReplyAt: new Date(Date.now() - 60_000) });
    const auto = await createAutomation(acct, { mediaScope: "next", createdAt: new Date(Date.now() - 3_600_000) });
    graph.media["new-post"] = {
      id: "new-post",
      caption: "공구 오픈",
      mediaType: "VIDEO",
      mediaProductType: "REELS",
      thumbnailUrl: "https://thumb",
      mediaUrl: null,
      permalink: "https://instagram.com/p/x",
      timestamp: new Date(),
    };
    const ev = await createEvent(acct, { mediaId: "new-post" });
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("succeeded");
    const [bound] = await getDb().select().from(automations).where(eq(automations.id, auto.id));
    expect(bound).toMatchObject({ mediaScope: "specific", mediaId: "new-post", mediaPermalink: "https://instagram.com/p/x" });
  });

  it("does not bind 'next post' to media published before the automation", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createAutomation(acct, { mediaScope: "next" });
    graph.media["old-post"] = {
      id: "old-post", caption: null, mediaType: "IMAGE", mediaProductType: "FEED", thumbnailUrl: null, mediaUrl: null, permalink: null,
      timestamp: new Date(Date.now() - 86_400_000),
    };
    const ev = await createEvent(acct, { mediaId: "old-post" });
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("skipped");
  });

  it("replies to the parent comment when the trigger is itself a reply", async () => {
    const { acct } = await world();
    const ev = await createEvent(acct, { parentCommentId: "parent-1" });
    await processCommentEvent(deps(), await claim(ev.id));
    expect(graph.replies[0].commentId).toBe("parent-1");
    expect(graph.dms[0].commentId).toBe(ev.commentId);
  });

  it("sends only the DM when public replies are disabled", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createAutomation(acct, { replyEnabled: false, replyTexts: [] });
    const ev = await createEvent(acct);
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("succeeded");
    expect(graph.replies).toHaveLength(0);
    expect(await eventRow(ev.id)).toMatchObject({ replyStatus: "skipped", dmStatus: "sent" });
  });

  it("responds to any comment when the automation uses the 'any' match type", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id, { nextReplyAt: new Date(Date.now() - 60_000) });
    await createAutomation(acct, { matchType: "any", keywords: [] });
    const ev = await createEvent(acct, { commentText: "너무 예뻐요" });
    expect(await processCommentEvent(deps(), await claim(ev.id))).toBe("succeeded");
    expect(graph.dms).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --project integration tests/integration/pipeline.test.ts`
Expected: FAIL — `Cannot find module '@/server/pipeline/process-comment'`

- [ ] **Step 3: `src/server/pipeline/process-comment.ts` 구현**

```ts
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Plan } from "@/lib/plans";
import { rulesToBind, selectAutomation } from "@/server/automations/matcher";
import { brandingLine, buildTextFallback, renderReply, truncateChars } from "@/server/automations/render";
import { getUserPlan } from "@/server/billing/plan-of";
import type { Db } from "@/server/db/client";
import {
  automations,
  commentEvents,
  igAccounts,
  mediaCache,
  type Automation,
  type CommentEvent,
  type IgAccount,
  type PartStatus,
  type SkipReason,
} from "@/server/db/schema";
import { classifyError, type ClassifiedError } from "@/server/instagram/errors";
import type { GraphClient } from "@/server/instagram/graph";
import { getOrCreateEventLink } from "@/server/links";
import { backoffDelayMs, MAX_ATTEMPTS } from "@/server/queue/backoff";
import { finishEvent, requeueEvent, updateEvent, type EventPatch } from "@/server/queue/events";
import { reserveSendSlot } from "@/server/ratelimit";
import { releaseDm, reserveDm } from "@/server/usage";
import { releaseDelivery, reserveDelivery } from "./deliveries";

export interface PipelineDeps {
  db: Db;
  graph: GraphClient;
  now: () => Date;
  random: () => number;
  sleep: (ms: number) => Promise<void>;
  appUrl: string;
  hourlyLimit: number;
  decryptToken: (enc: string) => string;
  onAuthFailure?: (account: IgAccount) => Promise<void>;
}

export type ProcessOutcome = "succeeded" | "partial" | "failed" | "skipped" | "expired" | "deferred" | "retry";

const SEND_WINDOW_MS = 7 * 86_400_000;
const MAX_INLINE_WAIT_MS = 5_000;
const RATE_LIMIT_RETRY_MS = 5 * 60_000;
const BUTTON_TEXT_MAX = 640;

interface Ctx {
  event: CommentEvent;
  account: IgAccount;
  usagePeriod: string | null;
}

export async function processCommentEvent(deps: PipelineDeps, event: CommentEvent): Promise<ProcessOutcome> {
  const { db } = deps;
  const now = deps.now();
  const deadline = event.receivedAt.getTime() + SEND_WINDOW_MS;

  const [account] = await db.select().from(igAccounts).where(eq(igAccounts.id, event.igAccountId)).limit(1);
  if (!account) return skip(deps, event.id, "account_inactive");
  const ctx: Ctx = { event, account, usagePeriod: event.usagePeriod };

  if (now.getTime() >= deadline) return expire(deps, ctx);
  if (account.status !== "active" || !account.accessTokenEnc) {
    await releaseReservations(db, ctx);
    return skip(deps, event.id, "account_inactive", { usagePeriod: null });
  }
  if (await isSelfComment(db, event, account)) return skip(deps, event.id, "self");

  let automation: Automation | null;
  if (event.automationId) {
    const [row] = await db.select().from(automations).where(eq(automations.id, event.automationId)).limit(1);
    automation = row?.isActive ? row : null;
    if (!automation) {
      await releaseReservations(db, ctx);
      return skip(deps, event.id, "automation_inactive", { usagePeriod: null });
    }
  } else {
    automation = await matchAutomation(deps, event, account);
    if (!automation) return skip(deps, event.id, "no_match");
    await updateEvent(db, event.id, { automationId: automation.id });
  }

  const plan = await getUserPlan(db, account.userId);

  const dedupe = await reserveDelivery(db, {
    automationId: automation.id,
    mediaId: event.mediaId,
    commenterIgId: event.commenterIgId,
    eventId: event.id,
  });
  if (dedupe === "duplicate") {
    if (ctx.usagePeriod) await releaseDm(db, account.userId, ctx.usagePeriod);
    return skip(deps, event.id, "duplicate", { usagePeriod: null });
  }

  if (!ctx.usagePeriod) {
    ctx.usagePeriod = await reserveDm(db, account.userId, plan.monthlyDmLimit, now);
    if (!ctx.usagePeriod) {
      await releaseDelivery(db, event.id);
      return skip(deps, event.id, "quota");
    }
    await updateEvent(db, event.id, { usagePeriod: ctx.usagePeriod });
  }

  const slot =
    event.dmReservedAt ??
    (await reserveSendSlot(db, {
      igAccountId: account.id,
      eventId: event.id,
      now,
      hourlyLimit: deps.hourlyLimit,
      random: deps.random,
    }));
  if (slot.getTime() >= deadline) return expire(deps, ctx);
  const wait = slot.getTime() - now.getTime();
  if (wait > MAX_INLINE_WAIT_MS) {
    await requeueEvent(db, event.id, slot, {}, { refundAttempt: true });
    return "deferred";
  }
  if (wait > 0) await deps.sleep(wait);

  return sendAndSettle(deps, ctx, automation, plan, deadline);
}

async function sendAndSettle(
  deps: PipelineDeps,
  ctx: Ctx,
  automation: Automation,
  plan: Plan,
  deadline: number,
): Promise<ProcessOutcome> {
  const { db } = deps;
  const { event, account } = ctx;
  const token = deps.decryptToken(account.accessTokenEnc ?? "");

  let replyStatus = event.replyStatus;
  let dmStatus = event.dmStatus;
  let replyError: ClassifiedError | null = null;
  let dmError: ClassifiedError | null = null;

  if (!automation.replyEnabled || automation.replyTexts.length === 0) {
    replyStatus = "skipped";
  } else if (replyStatus === null) {
    const template = automation.replyTexts[Math.floor(deps.random() * automation.replyTexts.length)];
    try {
      const res = await deps.graph.replyToComment(
        token,
        event.parentCommentId ?? event.commentId,
        renderReply(template, event.commenterUsername),
      );
      replyStatus = "sent";
      await updateEvent(db, event.id, { replyStatus, replyCommentId: res.id });
    } catch (e) {
      replyError = classifyError(e);
      if (isFinalError(replyError)) replyStatus = "failed";
    }
  }
  if (replyStatus !== event.replyStatus) await updateEvent(db, event.id, { replyStatus });

  if (dmStatus === null && replyError?.cls !== "auth") {
    try {
      const res = await sendDm(deps, { account, automation, event, plan, token });
      dmStatus = "sent";
      await updateEvent(db, event.id, { dmStatus, dmMessageId: res.messageId });
    } catch (e) {
      dmError = classifyError(e);
      if (isFinalError(dmError)) {
        dmStatus = "failed";
        await updateEvent(db, event.id, { dmStatus });
      }
    }
  }

  const errors = [replyError, dmError].filter((e): e is ClassifiedError => e !== null);

  if (errors.some((e) => e.cls === "auth")) {
    await db.update(igAccounts).set({ status: "reauth_required" }).where(eq(igAccounts.id, account.id));
    await deps.onAuthFailure?.(account);
    return settle(deps, ctx, replyStatus ?? "failed", dmStatus ?? "failed", errors.find((e) => e.cls === "auth") ?? null);
  }

  const retryable = errors.filter((e) => e.cls === "rate_limited" || e.cls === "transient");
  if (retryable.length > 0) {
    const rateLimited = retryable.some((e) => e.cls === "rate_limited");
    const delay = rateLimited ? RATE_LIMIT_RETRY_MS : backoffDelayMs(event.attempts, deps.random);
    const runAt = new Date(deps.now().getTime() + delay);
    if ((rateLimited || event.attempts < MAX_ATTEMPTS) && runAt.getTime() < deadline) {
      await requeueEvent(
        db,
        event.id,
        runAt,
        { dmReservedAt: null, errorCode: retryable[0].code, errorMessage: retryable[0].message },
        { refundAttempt: rateLimited },
      );
      return "retry";
    }
  }

  return settle(deps, ctx, replyStatus ?? "failed", dmStatus ?? "failed", errors[0] ?? null);
}

function isFinalError(e: ClassifiedError): boolean {
  return e.cls === "permanent" || e.cls === "invalid_message";
}

async function settle(
  deps: PipelineDeps,
  ctx: Ctx,
  replyStatus: PartStatus,
  dmStatus: PartStatus,
  error: ClassifiedError | null,
): Promise<ProcessOutcome> {
  const replyOk = replyStatus !== "failed";
  const dmOk = dmStatus === "sent";
  const status = replyOk && dmOk ? "succeeded" : replyStatus === "sent" || dmOk ? "partial" : "failed";
  if (!dmOk) await releaseReservations(deps.db, ctx);
  await finishEvent(
    deps.db,
    ctx.event.id,
    status,
    {
      replyStatus,
      dmStatus,
      usagePeriod: ctx.usagePeriod,
      errorCode: status === "succeeded" ? null : (error?.code ?? ctx.event.errorCode),
      errorMessage: status === "succeeded" ? null : (error?.message ?? ctx.event.errorMessage),
    },
    deps.now(),
  );
  return status;
}

async function releaseReservations(db: Db, ctx: Ctx): Promise<void> {
  await releaseDelivery(db, ctx.event.id);
  if (ctx.usagePeriod) {
    await releaseDm(db, ctx.account.userId, ctx.usagePeriod);
    ctx.usagePeriod = null;
  }
}

async function expire(deps: PipelineDeps, ctx: Ctx): Promise<ProcessOutcome> {
  await releaseReservations(deps.db, ctx);
  await finishEvent(deps.db, ctx.event.id, "expired", { errorCode: "expired", usagePeriod: null }, deps.now());
  return "expired";
}

async function skip(
  deps: PipelineDeps,
  id: string,
  reason: SkipReason,
  patch: EventPatch = {},
): Promise<ProcessOutcome> {
  await finishEvent(deps.db, id, "skipped", { skipReason: reason, ...patch }, deps.now());
  return "skipped";
}

async function isSelfComment(db: Db, event: CommentEvent, account: IgAccount): Promise<boolean> {
  if (event.commenterIgId === account.igUserId) return true;
  if (event.commenterUsername && event.commenterUsername.toLowerCase() === account.username.toLowerCase()) {
    return true;
  }
  const [own] = await db
    .select({ id: commentEvents.id })
    .from(commentEvents)
    .where(eq(commentEvents.replyCommentId, event.commentId))
    .limit(1);
  return Boolean(own);
}

async function matchAutomation(deps: PipelineDeps, event: CommentEvent, account: IgAccount): Promise<Automation | null> {
  const { db } = deps;
  const loadRules = () =>
    db
      .select()
      .from(automations)
      .where(and(eq(automations.igAccountId, account.id), eq(automations.isActive, true)));

  let rules = await loadRules();
  if (rules.length === 0) return null;

  const unbound = rules.filter((r) => r.mediaScope === "next" && r.mediaId === null);
  if (unbound.length > 0) {
    const media = await getMediaInfo(deps, account, event.mediaId);
    const ids = rulesToBind(unbound, media?.timestamp ?? null);
    if (ids.length > 0) {
      await db
        .update(automations)
        .set({
          mediaScope: "specific",
          mediaId: event.mediaId,
          mediaPermalink: media?.permalink ?? null,
          mediaThumbnailUrl: media?.thumbnailUrl ?? null,
          mediaCaption: media?.caption ? truncateChars(media.caption, 300) : null,
        })
        .where(and(inArray(automations.id, ids), isNull(automations.mediaId)));
      rules = await loadRules();
    }
  }
  return selectAutomation(rules, event.mediaId, event.commentText);
}

async function getMediaInfo(
  deps: PipelineDeps,
  account: IgAccount,
  mediaId: string,
): Promise<{ timestamp: Date | null; permalink: string | null; thumbnailUrl: string | null; caption: string | null } | null> {
  const [cached] = await deps.db.select().from(mediaCache).where(eq(mediaCache.mediaId, mediaId)).limit(1);
  if (cached) return cached;
  try {
    const m = await deps.graph.getMedia(deps.decryptToken(account.accessTokenEnc ?? ""), mediaId);
    const row = {
      mediaId,
      igAccountId: account.id,
      timestamp: m.timestamp,
      permalink: m.permalink,
      thumbnailUrl: m.thumbnailUrl ?? m.mediaUrl,
      caption: m.caption,
      mediaProductType: m.mediaProductType,
      fetchedAt: deps.now(),
    };
    await deps.db.insert(mediaCache).values(row).onConflictDoNothing();
    return row;
  } catch {
    return null;
  }
}

async function sendDm(
  deps: PipelineDeps,
  p: { account: IgAccount; automation: Automation; event: CommentEvent; plan: Plan; token: string },
): Promise<{ messageId: string }> {
  const { account, automation, event, plan, token } = p;
  const url = plan.linkTracking
    ? `${deps.appUrl}/l/${await getOrCreateEventLink(deps.db, {
        eventId: event.id,
        automationId: automation.id,
        targetUrl: automation.dmLinkUrl,
      })}`
    : automation.dmLinkUrl;
  const text = plan.branding ? `${automation.dmText}\n\n${brandingLine()}` : automation.dmText;
  const textMessage = { kind: "text" as const, text: buildTextFallback(text, automation.dmButtonTitle, url) };

  if (account.dmFormat === "text") {
    return deps.graph.sendPrivateReply(token, account.igUserId, event.commentId, textMessage);
  }
  try {
    return await deps.graph.sendPrivateReply(token, account.igUserId, event.commentId, {
      kind: "button",
      text: truncateChars(text, BUTTON_TEXT_MAX),
      buttonTitle: automation.dmButtonTitle,
      url,
    });
  } catch (e) {
    if (classifyError(e).cls !== "invalid_message") throw e;
    const res = await deps.graph.sendPrivateReply(token, account.igUserId, event.commentId, textMessage);
    await deps.db.update(igAccounts).set({ dmFormat: "text" }).where(eq(igAccounts.id, account.id));
    return res;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run --project integration tests/integration/pipeline.test.ts`
Expected: PASS (18 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/pipeline/process-comment.ts tests/integration/pipeline.test.ts
git commit -m "feat: add comment processing pipeline with retries, dedupe and DM fallback"
```

---

### Task 11: 이메일 알림과 워커 프로세스

**Files:**
- Create:
  - `src/server/email.ts`, `src/server/emails.ts`, `src/server/notifications.ts`
  - `src/worker/loop.ts`, `src/worker/scheduler.ts`, `src/worker/jobs.ts`, `src/worker/index.ts`
  - `scripts/build-worker.mjs`
- Test: `tests/unit/loop.test.ts`, `tests/unit/emails.test.ts`, `tests/integration/worker-jobs.test.ts`

**Interfaces:**
- Consumes: `processCommentEvent`, `claimEvents`, `QUEUE_CHANNEL`, `createDb`, `createGraphClient`, `decryptSecret`, `encryptSecret`, `classifyError`, `releaseDelivery`, `releaseDm`, `finishEvent`
- Produces:
  - `sendEmail(msg: { to; subject; html; text }): Promise<void>`
  - 이메일 템플릿 `emails.magicLink(url)`, `emails.reauthRequired(username)`, `emails.paymentFailed(planName, nextRetryAt | null)`, `emails.downgraded(reason)` → `{ subject, html, text }`
  - `notifyUser(db: Executor, userId: string, email: {subject, html, text}): Promise<void>`
  - `startEventLoop<T>(o: { concurrency; pollMs; claim(n): Promise<T[]>; handle(item: T): Promise<void>; onError(e): void }): { wake(): void; stop(): Promise<void> }`
  - `startScheduler(jobs: ScheduledJob[], o: { withLock; onError }): { stop(): void }`
  - `withJobLock(db: Db, name: string, fn: () => Promise<void>): Promise<boolean>`
  - `refreshExpiringTokens(deps): Promise<{ refreshed: number; flagged: number }>`
  - `expireStaleEvents(db, now): Promise<number>`
  - `cleanupOldData(db, now): Promise<void>`
  - `beat(db, workerId, now): Promise<void>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/unit/loop.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { startEventLoop } from "@/worker/loop";

describe("startEventLoop", () => {
  it("processes everything with bounded concurrency and drains on stop", async () => {
    const queue = Array.from({ length: 12 }, (_, i) => i);
    let active = 0;
    let maxActive = 0;
    const done: number[] = [];
    const loop = startEventLoop<number>({
      concurrency: 3,
      pollMs: 10,
      claim: async (n) => queue.splice(0, n),
      handle: async (item) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 15));
        active--;
        done.push(item);
      },
      onError: () => {},
    });
    await vi.waitFor(() => expect(done).toHaveLength(12), { timeout: 3000 });
    await loop.stop();
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("wake() triggers a claim before the poll interval", async () => {
    const claims: number[] = [];
    const loop = startEventLoop<number>({
      concurrency: 1,
      pollMs: 60_000,
      claim: async () => {
        claims.push(Date.now());
        return [];
      },
      handle: async () => {},
      onError: () => {},
    });
    await vi.waitFor(() => expect(claims.length).toBe(1));
    loop.wake();
    await vi.waitFor(() => expect(claims.length).toBe(2), { timeout: 1000 });
    await loop.stop();
  });

  it("reports handler errors and keeps going", async () => {
    const errors: unknown[] = [];
    const queue = [1, 2];
    const done: number[] = [];
    const loop = startEventLoop<number>({
      concurrency: 2,
      pollMs: 10,
      claim: async (n) => queue.splice(0, n),
      handle: async (i) => {
        if (i === 1) throw new Error("boom");
        done.push(i);
      },
      onError: (e) => errors.push(e),
    });
    await vi.waitFor(() => expect(done).toEqual([2]));
    await loop.stop();
    expect(errors).toHaveLength(1);
  });
});
```

`tests/unit/emails.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { emails } from "@/server/emails";

describe("email templates", () => {
  it("escapes html and includes the link", () => {
    const m = emails.magicLink("https://app.test/api/auth/magic-link/verify?token=a&b=<x>");
    expect(m.subject).toContain("로그인");
    expect(m.html).toContain("&lt;x&gt;");
    expect(m.text).toContain("https://app.test/api/auth/magic-link/verify?token=a&b=<x>");
  });
  it("renders reauth and billing notices", () => {
    expect(emails.reauthRequired("creator").text).toContain("@creator");
    expect(emails.paymentFailed("Pro", new Date("2026-10-02T00:00:00Z")).text).toContain("Pro");
    expect(emails.downgraded("payment_failed").subject).toContain("Free");
  });
});
```

`tests/integration/worker-jobs.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { commentEvents, deliveries, igAccounts, usageCounters, workerHeartbeats } from "@/server/db/schema";
import { GraphApiError } from "@/server/instagram/errors";
import { usagePeriod } from "@/server/usage";
import { beat, cleanupOldData, expireStaleEvents, refreshExpiringTokens, withJobLock } from "@/worker/jobs";
import { resetDb } from "../helpers/db";
import { createAutomation, createEvent, createIgAccount, createUser } from "../helpers/factories";
import { FakeGraphClient } from "../helpers/fake-graph";

const DAY = 86_400_000;

describe("worker jobs", () => {
  beforeEach(resetDb);

  it("refreshes tokens that expire within 7 days", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id, { tokenExpiresAt: new Date(Date.now() + 3 * DAY) });
    const graph = new FakeGraphClient();
    const now = new Date();
    const res = await refreshExpiringTokens({ db: getDb(), graph, now: () => now, encrypt: encryptSecret, decrypt: decryptSecret });
    expect(res.refreshed).toBe(1);
    const [row] = await getDb().select().from(igAccounts).where(eq(igAccounts.id, acct.id));
    expect(decryptSecret(row.accessTokenEnc ?? "")).toBe("refreshed");
    expect(row.tokenExpiresAt?.getTime()).toBe(now.getTime() + 5_184_000_000);
  });

  it("flags accounts whose refresh is rejected or already expired", async () => {
    const u = await createUser();
    const rejected = await createIgAccount(u.id, { tokenExpiresAt: new Date(Date.now() + DAY) });
    const expired = await createIgAccount(u.id, { tokenExpiresAt: new Date(Date.now() - DAY) });
    const graph = new FakeGraphClient();
    graph.refreshResult = new GraphApiError("invalid", 400, 190);
    const notified: string[] = [];
    const res = await refreshExpiringTokens({
      db: getDb(),
      graph,
      now: () => new Date(),
      encrypt: encryptSecret,
      decrypt: decryptSecret,
      onReauthRequired: async (a) => {
        notified.push(a.id);
      },
    });
    expect(res.flagged).toBe(2);
    const rows = await getDb().select().from(igAccounts);
    expect(rows.every((r) => r.status === "reauth_required")).toBe(true);
    expect(notified.sort()).toEqual([rejected.id, expired.id].sort());
  });

  it("expires pending events older than 7 days and releases reservations", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const auto = await createAutomation(acct);
    const period = usagePeriod(new Date());
    await getDb().insert(usageCounters).values({ userId: u.id, period, dmCount: 1 });
    const ev = await createEvent(acct, { receivedAt: new Date(Date.now() - 8 * DAY), automationId: auto.id, usagePeriod: period });
    await getDb().insert(deliveries).values({ automationId: auto.id, mediaId: ev.mediaId, commenterIgId: ev.commenterIgId, eventId: ev.id });
    expect(await expireStaleEvents(getDb(), new Date())).toBe(1);
    const [row] = await getDb().select().from(commentEvents).where(eq(commentEvents.id, ev.id));
    expect(row.status).toBe("expired");
    expect(await getDb().select().from(deliveries)).toHaveLength(0);
    const [usage] = await getDb().select().from(usageCounters);
    expect(usage.dmCount).toBe(0);
  });

  it("deletes old no-match events after 3 days and everything after 180 days", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const now = new Date();
    await createEvent(acct, { status: "skipped", skipReason: "no_match", createdAt: new Date(now.getTime() - 4 * DAY) });
    const keep = await createEvent(acct, { status: "succeeded", createdAt: new Date(now.getTime() - 4 * DAY) });
    await createEvent(acct, { status: "succeeded", createdAt: new Date(now.getTime() - 181 * DAY) });
    await cleanupOldData(getDb(), now);
    const rows = await getDb().select().from(commentEvents);
    expect(rows.map((r) => r.id)).toEqual([keep.id]);
  });

  it("records heartbeats and serializes jobs with an advisory lock", async () => {
    await beat(getDb(), "w1", new Date());
    expect(await getDb().select().from(workerHeartbeats)).toHaveLength(1);
    let inner: boolean | null = null;
    const outer = await withJobLock(getDb(), "job-a", async () => {
      inner = await withJobLock(getDb(), "job-a", async () => {});
    });
    expect(outer).toBe(true);
    expect(inner).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --project unit tests/unit/loop.test.ts tests/unit/emails.test.ts; pnpm vitest run --project integration tests/integration/worker-jobs.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 이메일 모듈**

`src/server/email.ts`:
```ts
import { Resend } from "resend";
import { getEnv } from "@/server/env";
import { log } from "@/server/log";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const env = getEnv();
  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV === "production") {
      log.error("email not sent: RESEND_API_KEY missing", { subject: msg.subject });
      return;
    }
    log.info("dev email (not sent)", { subject: msg.subject, text: msg.text });
    return;
  }
  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
  if (error) throw new Error(`resend: ${error.message}`);
}
```
`src/server/emails.ts`:
```ts
import { site } from "@/lib/site";

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="ko"><body style="font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;background:#f6f6f6;padding:24px">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
<h1 style="font-size:18px;margin:0 0 16px">${escapeHtml(title)}</h1>${bodyHtml}
<p style="color:#888;font-size:12px;margin-top:24px">${escapeHtml(site.name)} · ${escapeHtml(site.supportEmail)}</p>
</div></body></html>`;
}

const kst = (d: Date) => d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long", timeStyle: "short" });

export const emails = {
  magicLink(url: string): EmailContent {
    return {
      subject: `${site.name} 로그인 링크`,
      html: layout(
        "로그인 링크",
        `<p>아래 버튼을 눌러 로그인하세요. 링크는 5분간 유효합니다.</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">로그인하기</a></p>`,
      ),
      text: `${site.name} 로그인 링크 (5분간 유효): ${url}`,
    };
  },
  reauthRequired(username: string): EmailContent {
    const body = `@${username} 계정의 인스타그램 연결이 만료되어 자동 응답이 멈췄어요. 대시보드에서 다시 연결해주세요.`;
    return { subject: `[${site.name}] 인스타그램 다시 연결이 필요해요`, html: layout("다시 연결이 필요해요", `<p>${escapeHtml(body)}</p>`), text: body };
  },
  paymentFailed(planName: string, nextRetryAt: Date | null): EmailContent {
    const retry = nextRetryAt ? ` ${kst(nextRetryAt)}에 다시 결제를 시도합니다.` : "";
    const body = `${planName} 플랜 정기결제에 실패했어요.${retry} 결제 페이지에서 카드를 확인해주세요.`;
    return { subject: `[${site.name}] 정기결제 실패 안내`, html: layout("정기결제 실패", `<p>${escapeHtml(body)}</p>`), text: body };
  },
  downgraded(reason: "payment_failed" | "canceled"): EmailContent {
    const body =
      reason === "payment_failed"
        ? "결제가 3회 실패해 Free 플랜으로 변경됐어요. 한도를 넘는 자동화는 비활성화됐어요."
        : "구독이 해지되어 Free 플랜으로 변경됐어요. 한도를 넘는 자동화는 비활성화됐어요.";
    return { subject: `[${site.name}] Free 플랜으로 변경됐어요`, html: layout("플랜 변경 안내", `<p>${escapeHtml(body)}</p>`), text: body };
  },
};
```
`src/server/notifications.ts`:
```ts
import { eq } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { sendEmail } from "@/server/email";
import type { EmailContent } from "@/server/emails";
import { errorFields, log } from "@/server/log";

export async function notifyUser(db: Executor, userId: string, content: EmailContent): Promise<void> {
  const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1);
  if (!row) return;
  try {
    await sendEmail({ to: row.email, ...content });
  } catch (e) {
    log.error("notification failed", { userId, ...errorFields(e) });
  }
}
```

- [ ] **Step 4: `src/worker/loop.ts`**

```ts
export interface LoopOptions<T> {
  concurrency: number;
  pollMs: number;
  claim: (n: number) => Promise<T[]>;
  handle: (item: T) => Promise<void>;
  onError: (err: unknown) => void;
}

export function startEventLoop<T>(o: LoopOptions<T>): { wake(): void; stop(): Promise<void> } {
  let stopped = false;
  let inFlight = 0;
  let wakeUp: (() => void) | null = null;
  const tasks = new Set<Promise<void>>();

  const idle = (ms: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wakeUp = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      wakeUp = done;
    });

  const run = async () => {
    while (!stopped) {
      const free = o.concurrency - inFlight;
      if (free <= 0) {
        await idle(o.pollMs);
        continue;
      }
      let items: T[] = [];
      try {
        items = await o.claim(free);
      } catch (e) {
        o.onError(e);
        await idle(o.pollMs);
        continue;
      }
      if (items.length === 0) {
        await idle(o.pollMs);
        continue;
      }
      for (const item of items) {
        inFlight++;
        const task: Promise<void> = o
          .handle(item)
          .catch(o.onError)
          .finally(() => {
            inFlight--;
            tasks.delete(task);
            wakeUp?.();
          });
        tasks.add(task);
      }
    }
  };

  const loopDone = run();
  return {
    wake: () => wakeUp?.(),
    async stop() {
      stopped = true;
      wakeUp?.();
      await loopDone;
      await Promise.all([...tasks]);
    },
  };
}
```

- [ ] **Step 5: `src/worker/scheduler.ts`**

```ts
export interface ScheduledJob {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
}

export function startScheduler(
  jobs: ScheduledJob[],
  o: {
    withLock: (name: string, fn: () => Promise<void>) => Promise<unknown>;
    onError: (name: string, err: unknown) => void;
  },
): { stop(): void } {
  const timers = jobs.map((job) => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await o.withLock(job.name, job.run);
      } catch (e) {
        o.onError(job.name, e);
      } finally {
        running = false;
      }
    };
    void tick();
    return setInterval(() => void tick(), job.intervalMs);
  });
  return { stop: () => timers.forEach(clearInterval) };
}
```

- [ ] **Step 6: `src/worker/jobs.ts`**

```ts
import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { commentEvents, igAccounts, mediaCache, workerHeartbeats, type IgAccount } from "@/server/db/schema";
import { classifyError } from "@/server/instagram/errors";
import type { GraphClient } from "@/server/instagram/graph";
import { log } from "@/server/log";
import { releaseDelivery } from "@/server/pipeline/deliveries";
import { finishEvent } from "@/server/queue/events";
import { releaseDm } from "@/server/usage";

const DAY = 86_400_000;

export async function withJobLock(db: Db, name: string, fn: () => Promise<void>): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext(${`job:${name}`})) as locked`,
    );
    if (!rows[0]?.locked) return false;
    await fn();
    return true;
  });
}

export async function refreshExpiringTokens(deps: {
  db: Db;
  graph: GraphClient;
  now: () => Date;
  encrypt: (s: string) => string;
  decrypt: (s: string) => string;
  onReauthRequired?: (account: IgAccount) => Promise<void>;
}): Promise<{ refreshed: number; flagged: number }> {
  const { db } = deps;
  const now = deps.now();
  const due = await db
    .select()
    .from(igAccounts)
    .where(
      and(
        eq(igAccounts.status, "active"),
        isNotNull(igAccounts.accessTokenEnc),
        lt(igAccounts.tokenExpiresAt, new Date(now.getTime() + 7 * DAY)),
      ),
    )
    .limit(200);

  let refreshed = 0;
  let flagged = 0;
  const flag = async (account: IgAccount) => {
    await db.update(igAccounts).set({ status: "reauth_required" }).where(eq(igAccounts.id, account.id));
    flagged++;
    await deps.onReauthRequired?.(account);
  };

  for (const account of due) {
    if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= now.getTime()) {
      await flag(account);
      continue;
    }
    try {
      const res = await deps.graph.refreshToken(deps.decrypt(account.accessTokenEnc ?? ""));
      await db
        .update(igAccounts)
        .set({
          accessTokenEnc: deps.encrypt(res.accessToken),
          tokenExpiresAt: new Date(now.getTime() + res.expiresIn * 1000),
        })
        .where(eq(igAccounts.id, account.id));
      refreshed++;
    } catch (e) {
      const c = classifyError(e);
      if (c.cls === "auth" || c.cls === "permanent") await flag(account);
      else log.warn("token refresh deferred", { igAccountId: account.id, code: c.code });
    }
  }
  return { refreshed, flagged };
}

export async function expireStaleEvents(db: Db, now: Date): Promise<number> {
  const stale = await db
    .select({ id: commentEvents.id, usagePeriod: commentEvents.usagePeriod, userId: igAccounts.userId })
    .from(commentEvents)
    .innerJoin(igAccounts, eq(igAccounts.id, commentEvents.igAccountId))
    .where(and(eq(commentEvents.status, "pending"), lt(commentEvents.receivedAt, new Date(now.getTime() - 7 * DAY))))
    .limit(500);
  for (const ev of stale) {
    await releaseDelivery(db, ev.id);
    if (ev.usagePeriod) await releaseDm(db, ev.userId, ev.usagePeriod);
    await finishEvent(db, ev.id, "expired", { errorCode: "expired", usagePeriod: null }, now);
  }
  return stale.length;
}

export async function cleanupOldData(db: Db, now: Date): Promise<void> {
  await db
    .delete(commentEvents)
    .where(
      and(
        eq(commentEvents.status, "skipped"),
        inArray(commentEvents.skipReason, ["no_match", "self"]),
        lt(commentEvents.createdAt, new Date(now.getTime() - 3 * DAY)),
      ),
    );
  await db
    .delete(commentEvents)
    .where(
      and(
        inArray(commentEvents.status, ["succeeded", "partial", "failed", "skipped", "expired"]),
        lt(commentEvents.createdAt, new Date(now.getTime() - 180 * DAY)),
      ),
    );
  await db.delete(mediaCache).where(lt(mediaCache.fetchedAt, new Date(now.getTime() - 30 * DAY)));
  await db.delete(workerHeartbeats).where(lt(workerHeartbeats.beatAt, new Date(now.getTime() - DAY)));
}

export async function beat(db: Db, workerId: string, now: Date): Promise<void> {
  await db
    .insert(workerHeartbeats)
    .values({ workerId, beatAt: now })
    .onConflictDoUpdate({ target: workerHeartbeats.workerId, set: { beatAt: now } });
}
```

- [ ] **Step 7: `src/worker/index.ts`**

```ts
import { hostname } from "node:os";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { createDb } from "@/server/db/client";
import { emails } from "@/server/emails";
import { getEnv } from "@/server/env";
import { createGraphClient } from "@/server/instagram/graph";
import { errorFields, log } from "@/server/log";
import { notifyUser } from "@/server/notifications";
import { processCommentEvent, type PipelineDeps } from "@/server/pipeline/process-comment";
import { claimEvents, QUEUE_CHANNEL } from "@/server/queue/events";
import { beat, cleanupOldData, expireStaleEvents, refreshExpiringTokens, withJobLock } from "./jobs";
import { startEventLoop } from "./loop";
import { startScheduler, type ScheduledJob } from "./scheduler";

const MINUTE = 60_000;

async function main() {
  const env = getEnv();
  const { db, sql } = createDb(env.DATABASE_URL, { max: env.WORKER_CONCURRENCY + 4 });
  const graph = createGraphClient({ version: env.IG_GRAPH_API_VERSION });
  const workerId = `${hostname()}-${process.pid}`;

  const deps: PipelineDeps = {
    db,
    graph,
    now: () => new Date(),
    random: Math.random,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    appUrl: env.APP_URL,
    hourlyLimit: env.IG_PRIVATE_REPLY_HOURLY_LIMIT,
    decryptToken: decryptSecret,
    onAuthFailure: (a) => notifyUser(db, a.userId, emails.reauthRequired(a.username)),
  };

  const loop = startEventLoop({
    concurrency: env.WORKER_CONCURRENCY,
    pollMs: 2000,
    claim: (n) => claimEvents(db, { batch: n, now: new Date() }),
    handle: async (event) => {
      const outcome = await processCommentEvent(deps, event);
      log.info("event processed", { eventId: event.id, outcome, attempts: event.attempts });
    },
    onError: (e) => log.error("event loop error", errorFields(e)),
  });

  await sql.listen(QUEUE_CHANNEL, () => loop.wake());

  const jobs: ScheduledJob[] = [
    {
      name: "refresh-tokens",
      intervalMs: 60 * MINUTE,
      run: async () => {
        const res = await refreshExpiringTokens({
          db,
          graph,
          now: () => new Date(),
          encrypt: encryptSecret,
          decrypt: decryptSecret,
          onReauthRequired: (a) => notifyUser(db, a.userId, emails.reauthRequired(a.username)),
        });
        log.info("token refresh", res);
      },
    },
    { name: "expire-events", intervalMs: 10 * MINUTE, run: async () => void (await expireStaleEvents(db, new Date())) },
    { name: "cleanup", intervalMs: 60 * MINUTE, run: () => cleanupOldData(db, new Date()) },
  ];
  const scheduler = startScheduler(jobs, {
    withLock: (name, fn) => withJobLock(db, name, fn),
    onError: (name, e) => log.error("scheduled job failed", { job: name, ...errorFields(e) }),
  });

  await beat(db, workerId, new Date());
  const heartbeat = setInterval(() => {
    beat(db, workerId, new Date()).catch((e) => log.error("heartbeat failed", errorFields(e)));
  }, 10_000);

  log.info("worker started", { workerId, concurrency: env.WORKER_CONCURRENCY });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("worker stopping", { signal });
    scheduler.stop();
    clearInterval(heartbeat);
    await loop.stop();
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  log.error("worker crashed", errorFields(e));
  process.exit(1);
});
```

- [ ] **Step 8: `scripts/build-worker.mjs`**

```js
import { build } from "esbuild";

await build({
  entryPoints: { worker: "src/worker/index.ts", migrate: "src/server/db/migrate.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
  tsconfig: "tsconfig.json",
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "info",
});
```

- [ ] **Step 9: 테스트 통과 확인**

Run: `pnpm vitest run --project unit tests/unit/loop.test.ts tests/unit/emails.test.ts && pnpm vitest run --project integration tests/integration/worker-jobs.test.ts`
Expected: PASS

- [ ] **Step 10: 워커 번들과 로컬 기동 확인**

Run: `pnpm build:worker && ls dist`
Expected: `worker.mjs`, `migrate.mjs` (+ `.map`)

Run: `pnpm worker:dev` (5초 후 Ctrl+C)
Expected: `{"level":"info",...,"msg":"worker started"...}` 로그, Ctrl+C 시 `worker stopping` 후 종료. `.env`의 `DATABASE_URL`이 dev DB를 가리켜야 한다(`pnpm db:migrate` 선행).

- [ ] **Step 11: Commit**

```bash
git add src/server/email.ts src/server/emails.ts src/server/notifications.ts src/worker scripts/build-worker.mjs tests/unit/loop.test.ts tests/unit/emails.test.ts tests/integration/worker-jobs.test.ts
git commit -m "feat: add worker process with event loop, scheduled jobs and email notifications"
```

---
### Task 12: 인증(Better Auth), 루트 레이아웃, 앱 셸

**Files:**
- Create: `src/server/auth.ts`, `src/server/session.ts`, `src/lib/auth-client.ts`, `src/app/api/auth/[...all]/route.ts`
- Create: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/login/login-form.tsx`
- Create: `src/app/app/layout.tsx`, `src/app/app/page.tsx` (임시), `src/components/app/app-nav.tsx`, `src/components/app/sign-out-button.tsx`
- Modify: `src/app/layout.tsx` (전체 교체), `src/app/globals.css` (`--font-sans`)
- Test: `tests/integration/auth.test.ts`

**Interfaces:**
- Consumes: `getDb`, `user/session/account/verification` 테이블, `sendEmail`, `emails.magicLink`, `getEnv`, `site`
- Produces:
  - `getAuth()`
  - `getSessionUser(): Promise<{ id: string; email: string; name: string } | null>`
  - `requireUser()` — 없으면 `/login`으로 redirect
  - `authClient` (클라이언트)
  - 앱 레이아웃 `/app/*`

- [ ] **Step 1: 실패하는 테스트 작성 (`tests/integration/auth.test.ts`)**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/auth/[...all]/route";
import { getDb } from "@/server/db/client";
import { verification } from "@/server/db/schema";
import { resetDb } from "../helpers/db";

describe("auth route", () => {
  beforeEach(resetDb);

  it("responds on the ok endpoint", async () => {
    const res = await GET(new Request("http://localhost:3000/api/auth/ok"));
    expect(res.status).toBe(200);
  });

  it("stores a magic-link verification token", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: "new@test.local", callbackURL: "/app" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await getDb().select().from(verification)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --project integration tests/integration/auth.test.ts`
Expected: FAIL — 라우트 모듈 없음

- [ ] **Step 3: `src/server/auth.ts`**

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { getDb } from "@/server/db/client";
import { account, session, user, verification } from "@/server/db/schema";
import { sendEmail } from "@/server/email";
import { emails } from "@/server/emails";
import { getEnv } from "@/server/env";

function createAuth() {
  const env = getEnv();
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (env.KAKAO_CLIENT_ID && env.KAKAO_CLIENT_SECRET) {
    socialProviders.kakao = { clientId: env.KAKAO_CLIENT_ID, clientSecret: env.KAKAO_CLIENT_SECRET };
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }
  return betterAuth({
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), { provider: "pg", schema: { user, session, account, verification } }),
    socialProviders,
    account: { accountLinking: { enabled: true, trustedProviders: ["kakao", "google"] } },
    plugins: [
      magicLink({
        expiresIn: 300,
        sendMagicLink: async ({ email, url }) => {
          await sendEmail({ to: email, ...emails.magicLink(url) });
        },
      }),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
```
`socialProviders`의 타입이 좁혀지지 않아 타입 오류가 나면 `{ kakao?: {...}; google?: {...} }` 객체 리터럴로 조건부 스프레드해 구성한다.

- [ ] **Step 4: 세션 헬퍼, 라우트, 클라이언트**

`src/server/session.ts`:
```ts
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  return u;
}
```
`src/app/api/auth/[...all]/route.ts`:
```ts
import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";

export async function GET(req: Request) {
  return toNextJsHandler(getAuth()).GET(req);
}

export async function POST(req: Request) {
  return toNextJsHandler(getAuth()).POST(req);
}
```
`src/lib/auth-client.ts`:
```ts
import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({ plugins: [magicLinkClient()] });
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run --project integration tests/integration/auth.test.ts`
Expected: PASS

- [ ] **Step 6: 루트 레이아웃과 폰트**

`src/app/layout.tsx` 전체 교체:
```tsx
import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import { site } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${site.name} — 인스타 댓글 자동 DM`, template: `%s | ${site.name}` },
  description: site.description,
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

const display = Hahmlet({ weight: ["600", "700", "800"], preload: false, display: "swap", variable: "--font-hahmlet" });
const sans = IBM_Plex_Sans_KR({ weight: ["400", "500", "600", "700"], preload: false, display: "swap", variable: "--font-plex" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${display.variable} ${sans.variable}`}>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
```
파일 상단 import에 `import { Hahmlet, IBM_Plex_Sans_KR } from "next/font/google";`를 추가한다. `preload: false`는 한글 글리프가 unicode-range 조각으로 제공되기 때문이다.

`src/app/globals.css`를 시안 토큰으로 맞춘다.
- `@theme inline { ... }` 블록에서 `--font-sans`를 아래 두 줄로 바꾸고, Geist 관련 `--font-mono` 줄은 지운다. 이후 `font-display` 클래스로 제목 서체를 쓴다.
- 같은 블록에 브랜드 색 토큰을 추가한다.
- `:root { ... }` 블록의 shadcn 색 변수 값을 시안 값으로 바꾼다. `.dark` 블록은 그대로 둔다(다크 모드는 범위 밖).
```css
@theme inline {
  /* ...shadcn이 만든 기존 줄 유지... */
  --font-sans: var(--font-plex), "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  --font-display: var(--font-hahmlet), "Nanum Myeongjo", serif;
  --color-brand: #FF5B35;
  --color-brand-ink: #D9401C;
  --color-ink-2: #3D352E;
  --color-chip: #FFE3D9;
  --color-chip-foreground: #7A2410;
  --color-success-soft: #DDF2E6;
  --color-success-ink: #14573A;
  --color-warning-soft: #FFF0D1;
  --color-warning-ink: #7A4700;
  --color-danger-soft: #FBE3E0;
  --color-danger-ink: #8F1D16;
}

:root {
  --radius: 0.875rem;
  --background: #F5F1EA;
  --foreground: #16120E;
  --card: #FFFFFF;
  --card-foreground: #16120E;
  --popover: #FFFFFF;
  --popover-foreground: #16120E;
  --primary: #16120E;
  --primary-foreground: #FFFFFF;
  --secondary: #EEE9E2;
  --secondary-foreground: #16120E;
  --muted: #EEE9E2;
  --muted-foreground: #6E655C;
  --accent: #FFE3D9;
  --accent-foreground: #7A2410;
  --destructive: #B3261E;
  --border: #E3DBCF;
  --input: #D8CFC3;
  --ring: #16120E;
}
```

- [ ] **Step 7: 로그인 페이지**

`src/app/(auth)/login/page.tsx`:
```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { site } from "@/lib/site";
import { getEnv } from "@/server/env";
import { getSessionUser } from "@/server/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "로그인" };

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/app");
  const env = getEnv();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-2 text-center text-2xl font-bold">
        {site.name}
      </Link>
      <p className="mb-8 text-center text-sm text-muted-foreground">댓글 하나로 DM 링크까지, 자동으로</p>
      <LoginForm
        kakao={Boolean(env.KAKAO_CLIENT_ID && env.KAKAO_CLIENT_SECRET)}
        google={Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)}
      />
      <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
        로그인하면 <Link href="/terms" className="underline">이용약관</Link>과{" "}
        <Link href="/privacy" className="underline">개인정보처리방침</Link>에 동의하게 됩니다.
      </p>
    </main>
  );
}
```
`src/app/(auth)/login/login-form.tsx`:
```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";

export function LoginForm({ kakao, google }: { kakao: boolean; google: boolean }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function social(provider: "kakao" | "google") {
    setPending(true);
    const { error } = await authClient.signIn.social({ provider, callbackURL: "/app" });
    if (error) {
      toast.error(error.message ?? "로그인에 실패했어요");
      setPending(false);
    }
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const { error } = await authClient.signIn.magicLink({ email, callbackURL: "/app" });
    setPending(false);
    if (error) toast.error(error.message ?? "메일 발송에 실패했어요");
    else setSent(true);
  }

  if (sent) {
    return (
      <div className="rounded-lg border bg-muted/40 p-6 text-center text-sm">
        <p className="font-medium">{email}로 로그인 링크를 보냈어요</p>
        <p className="mt-1 text-muted-foreground">메일함에서 링크를 눌러주세요. 5분간 유효해요.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {kakao && (
        <Button
          type="button"
          className="h-12 w-full bg-[#FEE500] text-[#191919] hover:bg-[#FEE500]/90"
          disabled={pending}
          onClick={() => social("kakao")}
        >
          카카오로 시작하기
        </Button>
      )}
      {google && (
        <Button type="button" variant="outline" className="h-12 w-full" disabled={pending} onClick={() => social("google")}>
          Google로 시작하기
        </Button>
      )}
      {(kakao || google) && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Separator className="flex-1" />
          또는
          <Separator className="flex-1" />
        </div>
      )}
      <form onSubmit={sendLink} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="email">이메일</Label>
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Button type="submit" className="h-12 w-full" disabled={pending}>
          이메일로 로그인 링크 받기
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 8: 앱 셸 (레이아웃, 하단 내비, 로그아웃, 임시 대시보드)**

`src/components/app/app-nav.tsx`:
```tsx
"use client";

import { CreditCard, Home, Settings, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const items = [
  { href: "/app", label: "홈", icon: Home, exact: true },
  { href: "/app/automations", label: "자동화", icon: Zap, exact: false },
  { href: "/app/billing", label: "결제", icon: CreditCard, exact: false },
  { href: "/app/settings", label: "설정", icon: Settings, exact: false },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto grid max-w-3xl grid-cols-4">
        {items.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-xs",
                  active ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```
`src/components/app/sign-out-button.tsx`:
```tsx
"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        await authClient.signOut();
        router.push("/");
        router.refresh();
      }}
    >
      로그아웃
    </Button>
  );
}
```
`src/app/app/layout.tsx`:
```tsx
import Link from "next/link";
import { AppNav } from "@/components/app/app-nav";
import { SignOutButton } from "@/components/app/sign-out-button";
import { site } from "@/lib/site";
import { requireUser } from "@/server/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-dvh bg-muted/40">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/app" className="font-bold">
            {site.name}
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-28 pt-6">{children}</main>
      <AppNav />
    </div>
  );
}
```
`src/app/app/page.tsx` (Task 15에서 교체):
```tsx
export default function DashboardPage() {
  return <h1 className="text-xl font-bold">대시보드</h1>;
}
```

- [ ] **Step 9: 수동 로그인 확인**

Run: `pnpm dev` 후 브라우저(또는 Browser pane)로 `http://localhost:3000/login`
- 이메일 입력 → "로그인 링크를 보냈어요" 표시
- 터미널 로그의 `dev email (not sent)` 줄에서 URL을 복사해 열기 → `/app`에 "대시보드" 표시
- `/app`을 로그아웃 상태로 열면 `/login`으로 이동
Expected: 위 3가지 동작. `pnpm typecheck && pnpm lint` 통과(외부 stylesheet `<link>`에 ESLint 경고만 있으면 허용, 오류면 해당 줄 위에 `{/* eslint-disable-next-line @next/next/no-css-tags */}` 추가).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add Better Auth login (Kakao, Google, magic link) and app shell"
```

---

### Task 13: Instagram 연동·웹훅·Meta 콜백·단축 링크·헬스 라우트

**Files:**
- Create: `src/server/instagram/client.ts`, `src/server/queue/ingest.ts`, `src/server/instagram/connect.ts`, `src/server/instagram/meta-callbacks.ts`
- Create routes:
  - `src/app/api/webhooks/instagram/route.ts`
  - `src/app/api/instagram/connect/route.ts`, `src/app/api/instagram/callback/route.ts`, `src/app/api/instagram/media/route.ts`
  - `src/app/api/meta/deauthorize/route.ts`, `src/app/api/meta/data-deletion/route.ts`
  - `src/app/l/[code]/route.ts`, `src/app/api/health/route.ts`
- Test: `tests/integration/ig-routes.test.ts`, `tests/integration/connect.test.ts`

**Interfaces:**
- Consumes: `verifyHubSignature`, `parseCommentWebhook`, `parseSignedRequest`, `enqueueComments`, `createGraphClient`, `exchangeCodeForToken`, `exchangeForLongLivedToken`, `buildAuthorizeUrl`, `getUserPlan`, `resolveLinkClick`, `isBotUserAgent`, `getSessionUser`
- Produces:
  - `getGraphClient(): GraphClient`
  - `setGraphClientForTesting(c: GraphClient | null): void`
  - `ingestComments(db: Db, comments: ParsedComment[], now: Date): Promise<number>`
  - `connectInstagramAccount(deps: ConnectDeps, p: { userId: string; code: string }): Promise<ConnectResult>`
  - `type ConnectResult = { ok: true; accountId: string } | { ok: false; reason: "oauth_failed" | "not_professional" | "owned_by_other" | "limit" | "subscribe_failed" }`
  - `disconnectIgAccounts(db: Executor, accountIds: string[]): Promise<void>`
  - `handleDeauthorize(db, metaUserId): Promise<number>`
  - `handleDataDeletion(db, metaUserId, appUrl): Promise<{ url: string; confirmationCode: string }>`
  - `IG_STATE_COOKIE`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/integration/ig-routes.test.ts`:
```ts
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as healthGET } from "@/app/api/health/route";
import { POST as dataDeletionPOST } from "@/app/api/meta/data-deletion/route";
import { POST as deauthPOST } from "@/app/api/meta/deauthorize/route";
import { GET as webhookGET, POST as webhookPOST } from "@/app/api/webhooks/instagram/route";
import { GET as linkGET } from "@/app/l/[code]/route";
import { getDb } from "@/server/db/client";
import { automations, commentEvents, dataDeletionRequests, igAccounts, links, workerHeartbeats } from "@/server/db/schema";
import { resetDb } from "../helpers/db";
import { createAutomation, createEvent, createIgAccount, createUser } from "../helpers/factories";

const BASE = "http://localhost:3000";

function signedWebhook(body: string, secret = "ig-app-secret") {
  return new Request(`${BASE}/api/webhooks/instagram`, {
    method: "POST",
    body,
    headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` },
  });
}

function signedRequest(payload: object, secret = "ig-app-secret") {
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const s = createHmac("sha256", secret).update(p).digest("base64url");
  return `${s}.${p}`;
}

function formPost(path: string, fields: Record<string, string>) {
  return new Request(`${BASE}${path}`, { method: "POST", body: new URLSearchParams(fields) });
}

describe("instagram webhook route", () => {
  beforeEach(resetDb);

  it("answers the verification handshake only with the right token", async () => {
    const ok = await webhookGET(new Request(`${BASE}/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=verify-token-123&hub.challenge=1158201444`));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("1158201444");
    const bad = await webhookGET(new Request(`${BASE}/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`));
    expect(bad.status).toBe(403);
  });

  it("rejects payloads with a bad signature", async () => {
    const res = await webhookPOST(signedWebhook("{}", "wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("queues each comment once, drops self comments and accepts the Meta app secret", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createAutomation(acct);
    const body = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: acct.igUserId,
          time: 1,
          changes: [
            { field: "comments", value: { from: { id: "f1", username: "fan" }, media: { id: "m1" }, id: "c-100", text: "공구" } },
            { field: "comments", value: { from: { id: acct.igUserId, username: acct.username }, media: { id: "m1" }, id: "c-101", text: "DM 확인" } },
          ],
        },
      ],
    });
    expect((await webhookPOST(signedWebhook(body))).status).toBe(200);
    expect((await webhookPOST(signedWebhook(body, "meta-app-secret"))).status).toBe(200);
    const rows = await getDb().select().from(commentEvents);
    expect(rows.map((r) => r.commentId)).toEqual(["c-100"]);
    expect(rows[0]).toMatchObject({ igAccountId: acct.id, commenterUsername: "fan", status: "pending" });
  });

  it("ignores accounts without active automations", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createAutomation(acct, { isActive: false });
    const body = JSON.stringify({
      object: "instagram",
      entry: [{ id: acct.igUserId, changes: [{ field: "comments", value: { from: { id: "f" }, media: { id: "m" }, id: "c-1", text: "공구" } }] }],
    });
    expect((await webhookPOST(signedWebhook(body))).status).toBe(200);
    expect(await getDb().select().from(commentEvents)).toHaveLength(0);
  });
});

describe("meta callbacks", () => {
  beforeEach(resetDb);

  it("deauthorize disconnects the account and turns automations off", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createAutomation(acct);
    const res = await deauthPOST(formPost("/api/meta/deauthorize", { signed_request: signedRequest({ algorithm: "HMAC-SHA256", user_id: acct.igScopedId }) }));
    expect(res.status).toBe(200);
    const [a] = await getDb().select().from(igAccounts).where(eq(igAccounts.id, acct.id));
    expect(a).toMatchObject({ status: "disconnected", accessTokenEnc: null });
    const [auto] = await getDb().select().from(automations);
    expect(auto.isActive).toBe(false);
  });

  it("data deletion removes the account data and returns a status url", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createEvent(acct);
    const res = await dataDeletionPOST(formPost("/api/meta/data-deletion", { signed_request: signedRequest({ algorithm: "HMAC-SHA256", user_id: acct.igUserId }) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; confirmation_code: string };
    expect(body.url).toBe(`${BASE}/data-deletion/${body.confirmation_code}`);
    expect(await getDb().select().from(igAccounts)).toHaveLength(0);
    expect(await getDb().select().from(commentEvents)).toHaveLength(0);
    const [reqRow] = await getDb().select().from(dataDeletionRequests);
    expect(reqRow.status).toBe("completed");
  });

  it("rejects unsigned callback requests", async () => {
    const res = await deauthPOST(formPost("/api/meta/deauthorize", { signed_request: signedRequest({ user_id: "1" }, "wrong") }));
    expect(res.status).toBe(400);
  });
});

describe("short link redirect", () => {
  beforeEach(resetDb);

  it("redirects and counts human clicks, not preview bots", async () => {
    const [row] = await getDb().insert(links).values({ code: "Abc1234", targetUrl: "https://shop.example.com/p/1" }).returning();
    const human = await linkGET(new Request(`${BASE}/l/Abc1234`, { headers: { "user-agent": "Mozilla/5.0 (iPhone) Instagram 350" } }), {
      params: Promise.resolve({ code: "Abc1234" }),
    });
    expect(human.status).toBe(302);
    expect(human.headers.get("location")).toBe("https://shop.example.com/p/1");
    await linkGET(new Request(`${BASE}/l/Abc1234`, { headers: { "user-agent": "facebookexternalhit/1.1" } }), {
      params: Promise.resolve({ code: "Abc1234" }),
    });
    const [after] = await getDb().select().from(links).where(eq(links.id, row.id));
    expect(after.clickCount).toBe(1);
  });

  it("returns 404 for unknown codes", async () => {
    const res = await linkGET(new Request(`${BASE}/l/Nope123`), { params: Promise.resolve({ code: "Nope123" }) });
    expect(res.status).toBe(404);
  });
});

describe("health", () => {
  beforeEach(resetDb);

  it("is healthy without strict mode and requires a fresh worker heartbeat in strict mode", async () => {
    expect((await healthGET(new Request(`${BASE}/api/health`))).status).toBe(200);
    expect((await healthGET(new Request(`${BASE}/api/health?strict=1`))).status).toBe(503);
    await getDb().insert(workerHeartbeats).values({ workerId: "w", beatAt: new Date() });
    expect((await healthGET(new Request(`${BASE}/api/health?strict=1`))).status).toBe(200);
  });
});
```

`tests/integration/connect.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { igAccounts } from "@/server/db/schema";
import { connectInstagramAccount, type ConnectDeps } from "@/server/instagram/connect";
import { GraphApiError } from "@/server/instagram/errors";
import { resetDb } from "../helpers/db";
import { createIgAccount, createUser } from "../helpers/factories";
import { FakeGraphClient } from "../helpers/fake-graph";

let graph: FakeGraphClient;

function deps(overrides: Partial<ConnectDeps> = {}): ConnectDeps {
  return {
    db: getDb(),
    graph,
    exchangeCode: async () => ({ accessToken: "short" }),
    exchangeLongLived: async () => ({ accessToken: "long-token", expiresIn: 5_184_000 }),
    encrypt: encryptSecret,
    now: () => new Date("2026-09-24T00:00:00Z"),
    ...overrides,
  };
}

describe("connectInstagramAccount", () => {
  beforeEach(async () => {
    await resetDb();
    graph = new FakeGraphClient();
  });

  it("stores the account with an encrypted long-lived token and subscribes webhooks", async () => {
    const u = await createUser();
    const res = await connectInstagramAccount(deps(), { userId: u.id, code: "c" });
    expect(res.ok).toBe(true);
    const [row] = await getDb().select().from(igAccounts);
    expect(row).toMatchObject({ userId: u.id, igUserId: "17841400000000001", igScopedId: "scoped-1", username: "creator", accountType: "BUSINESS", status: "active" });
    expect(decryptSecret(row.accessTokenEnc ?? "")).toBe("long-token");
    expect(row.tokenExpiresAt?.toISOString()).toBe("2026-11-23T00:00:00.000Z");
    expect(graph.subscribed).toEqual(["17841400000000001"]);
  });

  it("rejects personal accounts", async () => {
    const u = await createUser();
    graph.profile = { ...graph.profile, accountType: "PERSONAL" };
    expect(await connectInstagramAccount(deps(), { userId: u.id, code: "c" })).toEqual({ ok: false, reason: "not_professional" });
  });

  it("rejects an account already connected by another user", async () => {
    const owner = await createUser();
    await createIgAccount(owner.id, { igUserId: "17841400000000001" });
    const other = await createUser();
    expect(await connectInstagramAccount(deps(), { userId: other.id, code: "c" })).toEqual({ ok: false, reason: "owned_by_other" });
  });

  it("enforces the plan account limit but allows reconnecting the same account", async () => {
    const u = await createUser();
    await createIgAccount(u.id, { igUserId: "999" });
    expect(await connectInstagramAccount(deps(), { userId: u.id, code: "c" })).toEqual({ ok: false, reason: "limit" });
    graph.profile = { ...graph.profile, userId: "999" };
    expect((await connectInstagramAccount(deps(), { userId: u.id, code: "c" })).ok).toBe(true);
  });

  it("reports OAuth failures", async () => {
    const u = await createUser();
    const res = await connectInstagramAccount(
      deps({ exchangeCode: async () => { throw new GraphApiError("bad code", 400, 400); } }),
      { userId: u.id, code: "c" },
    );
    expect(res).toEqual({ ok: false, reason: "oauth_failed" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --project integration tests/integration/ig-routes.test.ts tests/integration/connect.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 공용 Graph 클라이언트 (`src/server/instagram/client.ts`)**

```ts
import { getEnv } from "@/server/env";
import { createGraphClient, type GraphClient } from "./graph";

let override: GraphClient | null = null;
let instance: GraphClient | null = null;

export function getGraphClient(): GraphClient {
  if (override) return override;
  instance ??= createGraphClient({ version: getEnv().IG_GRAPH_API_VERSION });
  return instance;
}

export function setGraphClientForTesting(client: GraphClient | null): void {
  override = client;
}
```

- [ ] **Step 4: 수집 (`src/server/queue/ingest.ts`)**

```ts
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { automations, igAccounts, type NewCommentEvent } from "@/server/db/schema";
import type { ParsedComment } from "@/server/instagram/webhook";
import { enqueueComments } from "./events";

export async function ingestComments(db: Db, comments: ParsedComment[], now: Date): Promise<number> {
  const candidates = comments.filter((c) => c.commenterIgId !== c.igUserId);
  if (candidates.length === 0) return 0;
  const igIds = [...new Set(candidates.map((c) => c.igUserId))];
  const accounts = await db
    .selectDistinct({ id: igAccounts.id, igUserId: igAccounts.igUserId })
    .from(igAccounts)
    .innerJoin(automations, and(eq(automations.igAccountId, igAccounts.id), eq(automations.isActive, true)))
    .where(and(inArray(igAccounts.igUserId, igIds), eq(igAccounts.status, "active")));
  const byIgId = new Map(accounts.map((a) => [a.igUserId, a.id]));

  const rows: NewCommentEvent[] = [];
  for (const c of candidates) {
    const igAccountId = byIgId.get(c.igUserId);
    if (!igAccountId) continue;
    rows.push({
      igAccountId,
      commentId: c.commentId,
      mediaId: c.mediaId,
      parentCommentId: c.parentCommentId,
      mediaProductType: c.mediaProductType,
      commenterIgId: c.commenterIgId,
      commenterUsername: c.commenterUsername,
      commentText: c.text,
      receivedAt: now,
      runAt: now,
    });
  }
  return enqueueComments(db, rows);
}
```

- [ ] **Step 5: 연동 유스케이스 (`src/server/instagram/connect.ts`)**

```ts
import { and, eq, ne, sql } from "drizzle-orm";
import { getUserPlan } from "@/server/billing/plan-of";
import type { Db } from "@/server/db/client";
import { igAccounts } from "@/server/db/schema";
import { errorFields, log } from "@/server/log";
import type { GraphClient, IgProfile } from "./graph";

export const IG_STATE_COOKIE = "ig_oauth_state";

export interface ConnectDeps {
  db: Db;
  graph: GraphClient;
  exchangeCode: (code: string) => Promise<{ accessToken: string }>;
  exchangeLongLived: (shortToken: string) => Promise<{ accessToken: string; expiresIn: number }>;
  encrypt: (plain: string) => string;
  now: () => Date;
}

export type ConnectResult =
  | { ok: true; accountId: string }
  | { ok: false; reason: "oauth_failed" | "not_professional" | "owned_by_other" | "limit" | "subscribe_failed" };

export async function connectInstagramAccount(
  deps: ConnectDeps,
  p: { userId: string; code: string },
): Promise<ConnectResult> {
  const { db } = deps;
  let token: { accessToken: string; expiresIn: number };
  let profile: IgProfile;
  try {
    const short = await deps.exchangeCode(p.code);
    token = await deps.exchangeLongLived(short.accessToken);
    profile = await deps.graph.getMe(token.accessToken);
  } catch (e) {
    log.warn("instagram oauth failed", errorFields(e));
    return { ok: false, reason: "oauth_failed" };
  }

  const accountType = profile.accountType.toUpperCase();
  if (accountType !== "BUSINESS" && accountType !== "MEDIA_CREATOR") return { ok: false, reason: "not_professional" };

  const [existing] = await db.select().from(igAccounts).where(eq(igAccounts.igUserId, profile.userId)).limit(1);
  if (existing && existing.userId !== p.userId) return { ok: false, reason: "owned_by_other" };

  if (!existing || existing.status === "disconnected") {
    const plan = await getUserPlan(db, p.userId);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(igAccounts)
      .where(and(eq(igAccounts.userId, p.userId), ne(igAccounts.status, "disconnected")));
    if (count >= plan.maxIgAccounts) return { ok: false, reason: "limit" };
  }

  const now = deps.now();
  const fields = {
    igScopedId: profile.id,
    username: profile.username,
    profilePictureUrl: profile.profilePictureUrl,
    accountType,
    accessTokenEnc: deps.encrypt(token.accessToken),
    tokenExpiresAt: new Date(now.getTime() + token.expiresIn * 1000),
    status: "active" as const,
  };
  const [row] = await db
    .insert(igAccounts)
    .values({ userId: p.userId, igUserId: profile.userId, ...fields })
    .onConflictDoUpdate({ target: igAccounts.igUserId, set: fields, setWhere: eq(igAccounts.userId, p.userId) })
    .returning({ id: igAccounts.id });
  if (!row) return { ok: false, reason: "owned_by_other" };

  try {
    await deps.graph.subscribeApp(token.accessToken, profile.userId);
  } catch (e) {
    log.warn("instagram webhook subscription failed", { igAccountId: row.id, ...errorFields(e) });
    return { ok: false, reason: "subscribe_failed" };
  }
  return { ok: true, accountId: row.id };
}
```

- [ ] **Step 6: Meta 콜백 도메인 (`src/server/instagram/meta-callbacks.ts`)**

```ts
import { eq, inArray, or } from "drizzle-orm";
import { randomToken } from "@/server/crypto";
import type { Db, Executor } from "@/server/db/client";
import { automations, dataDeletionRequests, igAccounts } from "@/server/db/schema";

async function findAccountIds(db: Executor, metaUserId: string): Promise<string[]> {
  const rows = await db
    .select({ id: igAccounts.id })
    .from(igAccounts)
    .where(or(eq(igAccounts.igScopedId, metaUserId), eq(igAccounts.igUserId, metaUserId)));
  return rows.map((r) => r.id);
}

export async function disconnectIgAccounts(db: Executor, accountIds: string[]): Promise<void> {
  if (accountIds.length === 0) return;
  await db
    .update(igAccounts)
    .set({ status: "disconnected", accessTokenEnc: null, tokenExpiresAt: null })
    .where(inArray(igAccounts.id, accountIds));
  await db.update(automations).set({ isActive: false }).where(inArray(automations.igAccountId, accountIds));
}

export async function handleDeauthorize(db: Db, metaUserId: string): Promise<number> {
  const ids = await findAccountIds(db, metaUserId);
  await disconnectIgAccounts(db, ids);
  return ids.length;
}

export async function handleDataDeletion(
  db: Db,
  metaUserId: string,
  appUrl: string,
): Promise<{ url: string; confirmationCode: string }> {
  const confirmationCode = randomToken(12);
  await db.insert(dataDeletionRequests).values({ confirmationCode, igUserId: metaUserId });
  const ids = await findAccountIds(db, metaUserId);
  if (ids.length > 0) await db.delete(igAccounts).where(inArray(igAccounts.id, ids));
  await db
    .update(dataDeletionRequests)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(dataDeletionRequests.confirmationCode, confirmationCode));
  return { url: `${appUrl}/data-deletion/${confirmationCode}`, confirmationCode };
}
```

- [ ] **Step 7: 웹훅 라우트 (`src/app/api/webhooks/instagram/route.ts`)**

```ts
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { parseCommentWebhook, verifyHubSignature } from "@/server/instagram/webhook";
import { log } from "@/server/log";
import { ingestComments } from "@/server/queue/ingest";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === getEnv().IG_WEBHOOK_VERIFY_TOKEN) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const env = getEnv();
  const raw = await req.text();
  if (!verifyHubSignature(raw, req.headers.get("x-hub-signature-256"), [env.IG_APP_SECRET, env.META_APP_SECRET])) {
    return new Response("invalid signature", { status: 401 });
  }
  const comments = parseCommentWebhook(raw);
  if (comments.length > 0) {
    const queued = await ingestComments(getDb(), comments, new Date());
    log.info("webhook received", { comments: comments.length, queued });
  }
  return new Response("ok", { status: 200 });
}
```

- [ ] **Step 8: 연동 시작·콜백·게시물 목록 라우트**

`src/app/api/instagram/connect/route.ts`:
```ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomToken } from "@/server/crypto";
import { getEnv } from "@/server/env";
import { IG_STATE_COOKIE } from "@/server/instagram/connect";
import { buildAuthorizeUrl } from "@/server/instagram/oauth";
import { getSessionUser } from "@/server/session";

export async function GET() {
  const env = getEnv();
  if (!(await getSessionUser())) return NextResponse.redirect(new URL("/login", env.APP_URL));
  const state = randomToken(24);
  (await cookies()).set(IG_STATE_COOKIE, state, {
    httpOnly: true,
    secure: env.APP_URL.startsWith("https://"),
    sameSite: "lax",
    maxAge: 600,
    path: "/api/instagram",
  });
  return NextResponse.redirect(
    buildAuthorizeUrl({ appId: env.IG_APP_ID, redirectUri: `${env.APP_URL}/api/instagram/callback`, state }),
  );
}
```
`src/app/api/instagram/callback/route.ts`:
```ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { encryptSecret, safeEqual } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { getGraphClient } from "@/server/instagram/client";
import { connectInstagramAccount, IG_STATE_COOKIE } from "@/server/instagram/connect";
import { exchangeCodeForToken, exchangeForLongLivedToken } from "@/server/instagram/oauth";
import { getSessionUser } from "@/server/session";

export async function GET(req: Request) {
  const env = getEnv();
  const url = new URL(req.url);
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.APP_URL));

  const jar = await cookies();
  const expected = jar.get(IG_STATE_COOKIE)?.value;
  jar.delete({ name: IG_STATE_COOKIE, path: "/api/instagram" });
  const fail = (reason: string) => NextResponse.redirect(new URL(`/app/onboarding?error=${reason}`, env.APP_URL));

  if (url.searchParams.get("error")) return fail("denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !expected || !safeEqual(state, expected)) return fail("state");

  const redirectUri = `${env.APP_URL}/api/instagram/callback`;
  const result = await connectInstagramAccount(
    {
      db: getDb(),
      graph: getGraphClient(),
      exchangeCode: (c) => exchangeCodeForToken({ appId: env.IG_APP_ID, appSecret: env.IG_APP_SECRET, redirectUri, code: c }),
      exchangeLongLived: (t) => exchangeForLongLivedToken({ appSecret: env.IG_APP_SECRET, shortToken: t }),
      encrypt: encryptSecret,
      now: () => new Date(),
    },
    { userId: user.id, code },
  );
  if (!result.ok) return fail(result.reason);
  return NextResponse.redirect(new URL("/app/onboarding?connected=1", env.APP_URL));
}
```
`src/app/api/instagram/media/route.ts`:
```ts
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { decryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { igAccounts } from "@/server/db/schema";
import { getGraphClient } from "@/server/instagram/client";
import { classifyError, errorReasonKo } from "@/server/instagram/errors";
import { getSessionUser } from "@/server/session";

const query = z.object({ accountId: z.uuid(), after: z.string().max(500).optional() });

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요" }, { status: 401 });
  const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "잘못된 요청이에요" }, { status: 400 });

  const [acct] = await getDb()
    .select()
    .from(igAccounts)
    .where(and(eq(igAccounts.id, parsed.data.accountId), eq(igAccounts.userId, user.id), eq(igAccounts.status, "active")))
    .limit(1);
  if (!acct?.accessTokenEnc) return NextResponse.json({ error: "계정을 찾을 수 없어요" }, { status: 404 });

  try {
    const res = await getGraphClient().listMedia(decryptSecret(acct.accessTokenEnc), acct.igUserId, parsed.data.after);
    return NextResponse.json({
      items: res.items.map((m) => ({
        id: m.id,
        caption: m.caption ? Array.from(m.caption).slice(0, 120).join("") : null,
        thumbnailUrl: m.thumbnailUrl ?? m.mediaUrl,
        permalink: m.permalink,
        mediaType: m.mediaType,
        timestamp: m.timestamp?.toISOString() ?? null,
      })),
      nextCursor: res.nextCursor,
    });
  } catch (e) {
    const c = classifyError(e);
    if (c.cls === "auth") {
      await getDb().update(igAccounts).set({ status: "reauth_required" }).where(eq(igAccounts.id, acct.id));
    }
    return NextResponse.json({ error: errorReasonKo(c.code) }, { status: 502 });
  }
}
```

- [ ] **Step 9: Meta 콜백 라우트**

`src/app/api/meta/deauthorize/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { handleDeauthorize } from "@/server/instagram/meta-callbacks";
import { parseSignedRequest } from "@/server/instagram/signed-request";
import { log } from "@/server/log";

export async function POST(req: Request) {
  const env = getEnv();
  const form = await req.formData();
  const signed = parseSignedRequest(String(form.get("signed_request") ?? ""), [env.IG_APP_SECRET, env.META_APP_SECRET]);
  if (!signed) return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });
  const count = await handleDeauthorize(getDb(), signed.userId);
  log.info("meta deauthorize", { accounts: count });
  return NextResponse.json({ ok: true });
}
```
`src/app/api/meta/data-deletion/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { handleDataDeletion } from "@/server/instagram/meta-callbacks";
import { parseSignedRequest } from "@/server/instagram/signed-request";

export async function POST(req: Request) {
  const env = getEnv();
  const form = await req.formData();
  const signed = parseSignedRequest(String(form.get("signed_request") ?? ""), [env.IG_APP_SECRET, env.META_APP_SECRET]);
  if (!signed) return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });
  const res = await handleDataDeletion(getDb(), signed.userId, env.APP_URL);
  return NextResponse.json({ url: res.url, confirmation_code: res.confirmationCode });
}
```

- [ ] **Step 10: 단축 링크·헬스 라우트**

`src/app/l/[code]/route.ts`:
```ts
import { getDb } from "@/server/db/client";
import { isBotUserAgent, resolveLinkClick } from "@/server/links";

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const target = await resolveLinkClick(getDb(), code, {
    countClick: !isBotUserAgent(req.headers.get("user-agent")),
    now: new Date(),
  });
  if (!target) {
    return new Response("링크를 찾을 수 없어요.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(null, { status: 302, headers: { location: target, "cache-control": "no-store" } });
}
```
`src/app/api/health/route.ts`:
```ts
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { workerHeartbeats } from "@/server/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const strict = new URL(req.url).searchParams.get("strict") === "1";
  try {
    const [hb] = await getDb()
      .select({ beatAt: workerHeartbeats.beatAt })
      .from(workerHeartbeats)
      .orderBy(desc(workerHeartbeats.beatAt))
      .limit(1);
    const worker = Boolean(hb && Date.now() - hb.beatAt.getTime() < 60_000);
    const status = strict && !worker ? 503 : 200;
    return NextResponse.json({ ok: status === 200, db: true, worker }, { status, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, db: false, worker: false }, { status: 503 });
  }
}
```

- [ ] **Step 11: 통과 확인**

Run: `pnpm vitest run --project integration tests/integration/ig-routes.test.ts tests/integration/connect.test.ts && pnpm typecheck`
Expected: PASS, 타입 오류 없음

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: add Instagram OAuth, webhook ingestion, Meta callbacks, short links and health check"
```

---

### Task 14: 랜딩·가격·법적 페이지

**Files:**
- Delete: `src/app/page.tsx` (create-next-app 기본 홈 — `(marketing)/page.tsx`와 충돌)
- Create:
  - `src/app/(marketing)/layout.tsx`, `src/app/(marketing)/page.tsx`
  - `src/app/(marketing)/pricing/page.tsx`, `src/app/(marketing)/terms/page.tsx`, `src/app/(marketing)/privacy/page.tsx`, `src/app/(marketing)/refund/page.tsx`
  - `src/components/marketing/site-header.tsx`, `src/components/marketing/site-footer.tsx`, `src/components/marketing/pricing-cards.tsx`, `src/components/marketing/phone-demo.tsx`, `src/components/marketing/legal.tsx`
  - `src/app/robots.ts`, `src/app/sitemap.ts`
- Modify: `src/lib/site.ts` (`hostingProvider` 추가)

**Interfaces:**
- Consumes: `site`, `PLANS`, `formatKrw`
- Produces: 공개 페이지 `/`, `/pricing`, `/terms`, `/privacy`, `/refund`, `PricingCards` 컴포넌트(결제 페이지에서 재사용하지 않음, 마케팅 전용), `PhoneDemo`

- [ ] **Step 1: `site.ts`에 호스팅 업체 필드 추가**

`site` 객체에 `hostingProvider: "",`를 `business` 위에 추가한다.

- [ ] **Step 2: 공용 마케팅 컴포넌트**

`src/components/marketing/site-header.tsx`:
```tsx
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { site } from "@/lib/site";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-bold">
          {site.name}
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/pricing" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            가격
          </Link>
          <Link href="/login" className={buttonVariants({ size: "sm" })}>
            무료로 시작
          </Link>
        </nav>
      </div>
    </header>
  );
}
```
`src/components/marketing/site-footer.tsx`:
```tsx
import Link from "next/link";
import { site } from "@/lib/site";

export function SiteFooter() {
  const b = site.business;
  const rows = [
    ["상호", b.companyName],
    ["대표자", b.ceo],
    ["사업자등록번호", b.registrationNumber],
    ["통신판매업 신고번호", b.mailOrderNumber],
    ["주소", b.address],
    ["전화", b.phone],
    ["이메일", site.supportEmail],
  ].filter(([, v]) => v);
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-10 text-xs text-muted-foreground">
        <nav className="flex flex-wrap gap-4 text-sm text-foreground">
          <Link href="/terms">이용약관</Link>
          <Link href="/privacy" className="font-semibold">
            개인정보처리방침
          </Link>
          <Link href="/refund">환불정책</Link>
          <Link href="/pricing">가격</Link>
        </nav>
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p>
          {site.name}은 Meta의 공식 Instagram API만 사용하며, 인스타그램 비밀번호를 받거나 저장하지 않습니다. Instagram은 Meta
          Platforms, Inc.의 상표입니다.
        </p>
        <p>© {new Date().getFullYear()} {b.companyName || site.name}</p>
      </div>
    </footer>
  );
}
```
`src/components/marketing/phone-demo.tsx`:
```tsx
export function PhoneDemo() {
  return (
    <div className="mx-auto w-full max-w-[300px] rounded-[2.5rem] border-8 border-foreground/90 bg-background p-4 shadow-2xl">
      <div className="space-y-4 text-sm">
        <div className="aspect-[4/5] rounded-xl bg-gradient-to-br from-pink-200 via-orange-100 to-yellow-100" />
        <div className="space-y-2">
          <p>
            <span className="font-semibold">follower_ji</span> 공구요!!
          </p>
          <p className="pl-4 text-muted-foreground">
            <span className="font-semibold text-foreground">creator</span> @follower_ji DM 확인해주세요! 💌
          </p>
        </div>
        <div className="rounded-2xl bg-muted p-3">
          <p className="text-xs text-muted-foreground">DM · 방금</p>
          <p className="mt-1">요청하신 공구 링크 보내드려요 🙌</p>
          <div className="mt-2 rounded-lg bg-background py-2 text-center font-semibold">구매하러 가기</div>
        </div>
      </div>
    </div>
  );
}
```
`src/components/marketing/pricing-cards.tsx`:
```tsx
import { Check } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKrw, PLANS, type PlanId } from "@/lib/plans";
import { cn } from "@/lib/utils";

const FEATURES: Record<PlanId, string[]> = {
  free: ["인스타 계정 1개", "자동화 1개", "월 DM 300건", "공개 답글 + DM 자동 발송", "DM 하단 서비스 표시"],
  pro: ["인스타 계정 1개", "자동화 무제한", "월 DM 10,000건", "링크 클릭 추적", "서비스 표시 제거"],
  agency: ["인스타 계정 5개", "자동화 무제한", "월 DM 50,000건", "링크 클릭 추적", "서비스 표시 제거"],
};

export function PricingCards() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {(Object.keys(PLANS) as PlanId[]).map((id) => {
        const plan = PLANS[id];
        const featured = id === "pro";
        return (
          <Card key={id} className={cn(featured && "border-foreground shadow-lg")}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                {plan.name}
                {featured && <span className="rounded-full bg-foreground px-2 py-0.5 text-xs text-background">추천</span>}
              </CardTitle>
              <CardDescription>
                <span className="text-3xl font-bold text-foreground">{plan.priceKrw === 0 ? "0원" : formatKrw(plan.priceKrw)}</span>
                {plan.priceKrw > 0 && " / 월 (VAT 포함)"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {FEATURES[id].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className="size-4 shrink-0" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Link
                href={id === "free" ? "/login" : "/app/billing"}
                className={cn(buttonVariants({ variant: featured ? "default" : "outline" }), "w-full")}
              >
                {id === "free" ? "무료로 시작" : `${plan.name} 시작하기`}
              </Link>
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
```
`src/components/marketing/legal.tsx`:
```tsx
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">시행일: {updated}</p>
      <div className="mt-8 space-y-6 text-sm leading-7 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:bg-muted [&_th]:p-2 [&_ul]:list-disc">
        {children}
      </div>
    </article>
  );
}

export function Placeholder({ value, label }: { value: string; label: string }) {
  return value ? <>{value}</> : <span className="rounded bg-yellow-100 px-1 text-yellow-900">[{label} 입력 필요]</span>;
}
```

- [ ] **Step 3: 마케팅 레이아웃과 랜딩**

`src/app/(marketing)/layout.tsx`:
```tsx
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
```
`src/app/(marketing)/page.tsx`:
```tsx
import { BarChart3, Link2, MessageCircle, Repeat, ShieldCheck, Timer } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PhoneDemo } from "@/components/marketing/phone-demo";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

const steps = [
  { title: "인스타 계정 연결", body: "비즈니스·크리에이터 계정을 공식 인스타그램 로그인으로 연결해요." },
  { title: "키워드와 메시지 설정", body: "게시물을 고르고, 트리거 키워드와 답글·DM 내용을 적어요." },
  { title: "댓글이 달리면 자동 발송", body: "몇 초 안에 공개 답글과 링크 버튼이 담긴 DM이 나가요." },
];

const features = [
  { icon: MessageCircle, title: "공개 답글 + DM 동시 발송", body: "댓글에는 답글로, 링크는 DM으로. 팔로워가 기다리지 않아요." },
  { icon: Repeat, title: "답글 문구 랜덤화", body: "문구 3~5개를 번갈아 써서 반복 문구로 인한 스팸 판정을 피해요." },
  { icon: ShieldCheck, title: "중복 발송 방지", body: "같은 사람이 여러 번 댓글을 달아도 DM은 한 번만 보내요." },
  { icon: Timer, title: "발송 한도 자동 조절", body: "인스타그램 발송 한도에 맞춰 대기열로 나눠 보내 누락이 없어요." },
  { icon: Link2, title: "링크 클릭 추적", body: "DM 링크를 누가 얼마나 눌렀는지 자동화별로 확인해요. (Pro)" },
  { icon: BarChart3, title: "한눈에 보는 대시보드", body: "트리거·성공·실패 사유를 실시간으로 확인해요." },
];

const faqs = [
  { q: "개인 계정도 쓸 수 있나요?", a: "인스타그램 정책상 비즈니스 또는 크리에이터(프로페셔널) 계정만 연결할 수 있어요. 설정에서 무료로 전환할 수 있고, 가이드를 제공해요." },
  { q: "계정이 정지될 위험은 없나요?", a: `${site.name}은 Meta가 공식 제공하는 Instagram API만 사용하고, 댓글을 남긴 사람에게만 1회 발송해요. 팔로우·좋아요 자동화나 타인 게시물 댓글 기능은 없어요.` },
  { q: "인스타 비밀번호를 알려줘야 하나요?", a: "아니요. 인스타그램 공식 로그인 창에서 권한만 허용하면 되고, 비밀번호는 저장하지 않아요." },
  { q: "댓글이 한꺼번에 수천 개 달리면요?", a: "인스타그램의 시간당 발송 한도를 넘는 분량은 대기열에 넣고 순서대로 보내요. 댓글 후 7일이 지나면 인스타그램 정책상 보낼 수 없어요." },
];

export default function LandingPage() {
  return (
    <>
      <section className="mx-auto grid max-w-5xl items-center gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
        <div>
          <p className="text-sm font-semibold text-pink-600">인스타그램 댓글 자동 DM</p>
          <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight md:text-5xl">
            &ldquo;댓글에 <span className="text-pink-600">링크</span> 남겨주세요&rdquo;
            <br />한 줄이면 끝.
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            키워드 댓글이 달리면 공개 답글과 링크가 담긴 DM을 몇 초 안에 자동으로 보내요. 공구·자료 배포·이벤트 댓글을 더는 손으로
            답하지 마세요.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "h-12 px-6")}>
              무료로 시작하기
            </Link>
            <Link href="/pricing" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-12 px-6")}>
              가격 보기
            </Link>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">카드 등록 없이 무료 플랜으로 시작 · 월 DM 300건</p>
        </div>
        <PhoneDemo />
      </section>

      <section className="border-y bg-muted/30">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="text-center text-2xl font-bold">3분이면 첫 자동화 완성</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="rounded-xl bg-background p-6 shadow-sm">
                <span className="flex size-8 items-center justify-center rounded-full bg-foreground text-sm font-bold text-background">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16">
        <h2 className="text-center text-2xl font-bold">공구·이벤트 크리에이터를 위해 만들었어요</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 md:grid-cols-3">
          {features.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border p-6">
              <Icon className="size-6" aria-hidden />
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y bg-muted/30">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="text-center text-2xl font-bold">가격</h2>
          <div className="mt-10">
            <PricingCards />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-16">
        <h2 className="text-center text-2xl font-bold">자주 묻는 질문</h2>
        <div className="mt-8 divide-y rounded-xl border">
          {faqs.map((f) => (
            <details key={f.q} className="group p-5">
              <summary className="cursor-pointer list-none font-medium">{f.q}</summary>
              <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
        <div className="mt-12 text-center">
          <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "h-12 px-8")}>
            지금 무료로 시작하기
          </Link>
        </div>
      </section>
    </>
  );
}
```

- [ ] **Step 4: 가격 페이지**

`src/app/(marketing)/pricing/page.tsx`:
```tsx
import Link from "next/link";
import { PricingCards } from "@/components/marketing/pricing-cards";

export const metadata = { title: "가격" };

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-center text-3xl font-bold">필요한 만큼만 쓰세요</h1>
      <p className="mt-3 text-center text-muted-foreground">모든 플랜은 월 단위 자동 결제이며 언제든 해지할 수 있어요.</p>
      <div className="mt-10">
        <PricingCards />
      </div>
      <ul className="mx-auto mt-10 max-w-2xl space-y-2 text-sm text-muted-foreground">
        <li>· 월 DM 건수는 매월 1일(한국 시간)에 초기화돼요. 한도를 넘으면 다음 달까지 DM 발송이 멈춰요.</li>
        <li>· 상위 플랜으로 변경하면 즉시 새 플랜 요금이 결제되고 새 결제 주기가 시작돼요. 이전 플랜의 남은 기간은 환불되지 않아요.</li>
        <li>· 하위 플랜으로 변경하거나 해지하면 현재 결제 기간이 끝날 때 적용돼요.</li>
        <li>
          · 자세한 내용은 <Link href="/refund" className="underline">환불정책</Link>을 확인해주세요.
        </li>
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: 이용약관 (`src/app/(marketing)/terms/page.tsx`)**

```tsx
import { LegalPage, Placeholder } from "@/components/marketing/legal";
import { site } from "@/lib/site";

export const metadata = { title: "이용약관" };

export default function TermsPage() {
  const company = <Placeholder value={site.business.companyName} label="상호" />;
  return (
    <LegalPage title="이용약관" updated={site.effectiveDate}>
      <h2>제1조 (목적)</h2>
      <p>
        이 약관은 {company}(이하 &ldquo;회사&rdquo;)가 제공하는 {site.name} 서비스(이하 &ldquo;서비스&rdquo;)의 이용과 관련하여 회사와 회원의
        권리, 의무 및 책임사항을 정함을 목적으로 합니다.
      </p>
      <h2>제2조 (정의)</h2>
      <ol>
        <li>&ldquo;회원&rdquo;이란 이 약관에 동의하고 서비스에 가입한 자를 말합니다.</li>
        <li>&ldquo;연동 계정&rdquo;이란 회원이 서비스에 연결한 인스타그램 비즈니스 또는 크리에이터 계정을 말합니다.</li>
        <li>&ldquo;자동화&rdquo;란 연동 계정의 게시물에 특정 키워드 댓글이 달릴 때 공개 답글과 DM을 자동 발송하도록 회원이 설정한 규칙을 말합니다.</li>
        <li>&ldquo;유료 플랜&rdquo;이란 월 단위로 요금을 정기 결제하고 이용하는 Pro, Agency 플랜을 말합니다.</li>
      </ol>
      <h2>제3조 (약관의 효력과 변경)</h2>
      <p>
        회사는 이 약관을 서비스 화면에 게시합니다. 회사는 관련 법령을 위반하지 않는 범위에서 약관을 변경할 수 있으며, 변경 시 적용일 7일 전(회원에게
        불리한 변경은 30일 전)부터 공지합니다. 회원이 변경 약관에 동의하지 않으면 이용계약을 해지할 수 있습니다.
      </p>
      <h2>제4조 (서비스 내용)</h2>
      <ol>
        <li>연동 계정 게시물의 키워드 댓글에 대한 공개 답글 및 DM(Private Reply) 자동 발송</li>
        <li>발송 현황, 실패 사유, 링크 클릭 통계 제공</li>
        <li>기타 회사가 정하는 부가 기능</li>
      </ol>
      <p>
        서비스는 Meta Platforms, Inc.가 제공하는 공식 Instagram API를 통해 동작하며, 인스타그램의 정책·기술 제한(발송 가능 기간 7일, 시간당
        발송 한도 등)을 따릅니다.
      </p>
      <h2>제5조 (회원가입과 계정)</h2>
      <p>
        회원가입은 카카오·구글 계정 또는 이메일 인증으로 합니다. 회원은 자신의 계정 정보를 관리할 책임이 있으며, 타인에게 이용하게 해서는 안 됩니다.
      </p>
      <h2>제6조 (회원의 의무)</h2>
      <ol>
        <li>회원은 본인이 운영 권한을 가진 인스타그램 계정만 연동해야 합니다.</li>
        <li>회원은 Meta 플랫폼 약관, Instagram 커뮤니티 가이드라인, 정보통신망법 등 관련 법령을 준수해야 합니다.</li>
        <li>
          회원은 DM으로 발송하는 내용(광고성 정보 포함)에 대한 책임을 지며, 댓글로 요청한 사람에게 요청한 정보를 1회 제공하는 목적 외로 서비스를
          이용해서는 안 됩니다.
        </li>
        <li>불법 상품, 사기, 음란물, 개인정보 무단 수집 등 법령이나 공서양속에 반하는 링크·내용을 발송해서는 안 됩니다.</li>
      </ol>
      <h2>제7조 (유료 플랜과 결제)</h2>
      <ol>
        <li>유료 플랜은 회원이 등록한 카드로 매월 같은 날 자동 결제됩니다.</li>
        <li>결제에 실패하면 회사는 최대 3회까지 하루 간격으로 재시도하며, 모두 실패하면 Free 플랜으로 전환됩니다.</li>
        <li>상위 플랜으로 변경하면 즉시 새 플랜 요금이 결제되고 새 결제 주기가 시작됩니다.</li>
        <li>하위 플랜 변경과 해지는 현재 결제 기간 종료 시 적용됩니다.</li>
        <li>청약철회와 환불은 별도의 환불정책을 따릅니다.</li>
      </ol>
      <h2>제8조 (서비스의 변경·중단)</h2>
      <p>
        회사는 Meta의 API 정책 변경, 설비 점검, 천재지변 등 불가피한 사유가 있으면 서비스의 전부 또는 일부를 변경하거나 중단할 수 있으며, 가능한 한
        사전에 공지합니다. Meta 정책 변경으로 특정 기능 제공이 불가능해진 경우 회사는 해당 기간 이용요금의 환불 등 합리적인 조치를 합니다.
      </p>
      <h2>제9조 (이용 제한)</h2>
      <p>회원이 제6조를 위반하면 회사는 사전 통지 후(긴급한 경우 사후 통지) 자동화 중지, 이용 정지, 계약 해지를 할 수 있습니다.</p>
      <h2>제10조 (면책)</h2>
      <p>
        회사는 인스타그램 플랫폼의 장애, 정책 변경, 회원 계정에 대한 Meta의 제재 등 회사의 귀책사유 없이 발생한 손해에 대해 책임을 지지 않습니다. 다만
        회사의 고의 또는 중대한 과실로 인한 손해는 그러하지 않습니다.
      </p>
      <h2>제11조 (계약 해지)</h2>
      <p>회원은 설정 화면에서 언제든 탈퇴할 수 있습니다. 탈퇴 시 유료 플랜 정기결제는 중단되고, 개인정보는 개인정보처리방침에 따라 처리됩니다.</p>
      <h2>제12조 (분쟁 해결)</h2>
      <p>이 약관은 대한민국 법률에 따르며, 서비스와 관련한 분쟁은 민사소송법상 관할 법원에 제기합니다.</p>
      <p>문의: {site.supportEmail}</p>
    </LegalPage>
  );
}
```

- [ ] **Step 6: 개인정보처리방침 (`src/app/(marketing)/privacy/page.tsx`)**

```tsx
import { LegalPage, Placeholder } from "@/components/marketing/legal";
import { site } from "@/lib/site";

export const metadata = { title: "개인정보처리방침" };

export default function PrivacyPage() {
  const company = <Placeholder value={site.business.companyName} label="상호" />;
  return (
    <LegalPage title="개인정보처리방침" updated={site.effectiveDate}>
      <p>
        {company}(이하 &ldquo;회사&rdquo;)는 「개인정보 보호법」에 따라 {site.name} 이용자의 개인정보를 보호하고 관련 고충을 원활하게 처리하기 위해
        다음과 같이 개인정보처리방침을 수립·공개합니다.
      </p>

      <h2>1. 처리하는 개인정보 항목</h2>
      <table>
        <thead>
          <tr>
            <th>구분</th>
            <th>항목</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>회원가입·로그인</td>
            <td>이메일, 이름(닉네임), 프로필 이미지(카카오·구글 로그인 시 제공 범위)</td>
          </tr>
          <tr>
            <td>인스타그램 연동</td>
            <td>인스타그램 계정 ID, 사용자명, 프로필 사진 URL, 계정 유형, 액세스 토큰(암호화 저장)</td>
          </tr>
          <tr>
            <td>자동화 처리</td>
            <td>연동 계정 게시물에 댓글을 단 사람의 인스타그램 ID·사용자명, 댓글 내용, 발송 결과</td>
          </tr>
          <tr>
            <td>유료 결제</td>
            <td>결제자 이름, 휴대폰 번호, 카드사명·카드번호 일부, 빌링키(암호화 저장, 카드번호 원문은 수집하지 않음), 결제 내역</td>
          </tr>
          <tr>
            <td>자동 수집</td>
            <td>접속 IP, 브라우저 정보, 쿠키, 서비스 이용 기록, 단축 링크 클릭 시각</td>
          </tr>
        </tbody>
      </table>

      <h2>2. 처리 목적</h2>
      <ul>
        <li>회원 식별, 로그인, 부정 이용 방지</li>
        <li>키워드 댓글 감지, 공개 답글·DM 자동 발송, 중복 발송 방지, 발송 통계 제공</li>
        <li>유료 플랜 정기결제, 결제 실패·플랜 변경 안내</li>
        <li>문의 응대, 서비스 개선, 법령상 의무 이행</li>
      </ul>

      <h2>3. 보유 및 이용 기간</h2>
      <table>
        <thead>
          <tr>
            <th>항목</th>
            <th>보유 기간</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>회원 정보, 연동 계정 정보</td>
            <td>회원 탈퇴 또는 인스타그램 연결 해제·데이터 삭제 요청 시까지</td>
          </tr>
          <tr>
            <td>자동화 키워드와 일치하지 않은 댓글 기록</td>
            <td>수신 후 3일</td>
          </tr>
          <tr>
            <td>자동 발송 처리 기록(댓글 작성자 ID·사용자명·댓글 내용·결과)</td>
            <td>수신 후 180일</td>
          </tr>
          <tr>
            <td>결제·대금 결제 기록</td>
            <td>5년 (전자상거래 등에서의 소비자보호에 관한 법률)</td>
          </tr>
          <tr>
            <td>접속 기록</td>
            <td>3개월 (통신비밀보호법)</td>
          </tr>
        </tbody>
      </table>

      <h2>4. 처리 위탁 및 국외 이전</h2>
      <table>
        <thead>
          <tr>
            <th>수탁자</th>
            <th>위탁 업무</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>(주)코리아포트원 및 결제대행사(PG)</td>
            <td>정기결제 처리, 빌링키 발급·보관</td>
          </tr>
          <tr>
            <td>Resend, Inc. (미국)</td>
            <td>로그인 링크·서비스 안내 이메일 발송 (이전 항목: 이메일 주소, 이전 시점: 발송 시 네트워크 전송)</td>
          </tr>
          <tr>
            <td>
              <Placeholder value={site.hostingProvider} label="서버 호스팅 업체" />
            </td>
            <td>서버·데이터베이스 운영</td>
          </tr>
        </tbody>
      </table>
      <p>
        인스타그램 댓글 수신과 답글·DM 발송은 Meta Platforms, Inc.의 Instagram API를 통해 이루어지며, 해당 처리에는 Meta의 개인정보처리방침이
        함께 적용됩니다.
      </p>

      <h2>5. 파기 절차와 방법</h2>
      <p>
        보유 기간이 지나거나 처리 목적이 달성된 개인정보는 지체 없이 파기합니다. 전자 파일은 복구할 수 없는 방법으로 삭제하며, 백업본은 최대 7일 후
        순차 삭제됩니다.
      </p>

      <h2>6. 이용자의 권리와 행사 방법</h2>
      <ul>
        <li>이용자는 언제든 개인정보 열람·정정·삭제·처리정지를 요구할 수 있으며, 설정 화면의 회원 탈퇴 또는 아래 연락처로 요청할 수 있습니다.</li>
        <li>
          인스타그램 사용자는 인스타그램 앱의 [설정 → 앱 및 웹사이트]에서 {site.name} 연결을 제거하고 데이터 삭제를 요청할 수 있으며, 요청 시 관련
          데이터를 즉시 삭제하고 확인 코드를 제공합니다.
        </li>
        <li>연동 계정 게시물에 댓글을 단 사람은 아래 연락처로 본인의 처리 기록 삭제를 요청할 수 있습니다.</li>
      </ul>

      <h2>7. 쿠키</h2>
      <p>회사는 로그인 유지를 위해 필수 쿠키만 사용합니다. 브라우저 설정에서 쿠키를 거부할 수 있으나 이 경우 로그인이 필요한 기능을 이용할 수 없습니다.</p>

      <h2>8. 안전성 확보 조치</h2>
      <ul>
        <li>인스타그램 액세스 토큰과 빌링키 AES-256 암호화 저장</li>
        <li>전 구간 HTTPS 통신, 웹훅 서명 검증</li>
        <li>개인정보 접근 권한 최소화와 접근 기록 관리</li>
      </ul>

      <h2>9. 개인정보 보호책임자</h2>
      <p>
        성명: <Placeholder value={site.privacyOfficer.name} label="보호책임자 성명" /> · 이메일: {site.privacyOfficer.email}
      </p>
      <p>
        개인정보 침해 신고·상담은 개인정보침해신고센터(privacy.kisa.or.kr, 국번 없이 118), 개인정보분쟁조정위원회(www.kopico.go.kr,
        1833-6972)에 문의할 수 있습니다.
      </p>

      <h2>10. 고지 의무</h2>
      <p>이 방침은 {site.effectiveDate}부터 적용되며, 내용이 바뀌면 시행 7일 전부터 서비스 화면에 공지합니다.</p>
    </LegalPage>
  );
}
```

- [ ] **Step 7: 환불정책 (`src/app/(marketing)/refund/page.tsx`)**

```tsx
import { LegalPage } from "@/components/marketing/legal";
import { site } from "@/lib/site";

export const metadata = { title: "환불정책" };

export default function RefundPage() {
  return (
    <LegalPage title="환불정책" updated={site.effectiveDate}>
      <h2>1. 청약철회</h2>
      <p>유료 플랜 결제일로부터 7일 이내이고 해당 결제 기간에 자동 DM 발송 이력이 없으면 전액 환불해 드립니다.</p>
      <h2>2. 이용 후 해지</h2>
      <p>
        자동 발송 이력이 있거나 7일이 지난 경우, 이미 결제한 기간의 요금은 환불되지 않습니다. 해지하면 다음 결제일부터 청구가 중단되고 현재 결제 기간이
        끝날 때까지 유료 기능을 이용할 수 있습니다.
      </p>
      <h2>3. 플랜 변경</h2>
      <p>상위 플랜으로 변경할 때 이전 플랜의 남은 기간은 일할 환불되지 않습니다. 하위 플랜 변경은 현재 결제 기간 종료 후 적용됩니다.</p>
      <h2>4. 회사 귀책 사유</h2>
      <p>중복 결제, 결제 오류, 회사 사정으로 인한 서비스 장기 중단 등 회사의 귀책사유가 있으면 해당 금액을 전액 환불합니다.</p>
      <h2>5. 환불 신청</h2>
      <p>
        {site.supportEmail}로 가입 이메일과 결제일을 보내주시면 영업일 기준 3일 이내에 처리합니다. 환불은 결제한 카드의 승인 취소로 진행되며 카드사에
        따라 반영까지 3~7영업일이 걸릴 수 있습니다.
      </p>
    </LegalPage>
  );
}
```

- [ ] **Step 8: robots, sitemap, 기본 홈 삭제**

`src/app/robots.ts`:
```ts
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/app", "/api", "/l/"] }] };
}
```
`src/app/sitemap.ts`:
```ts
import type { MetadataRoute } from "next";

const base = process.env.APP_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/pricing", "/terms", "/privacy", "/refund"].map((p) => ({ url: `${base}${p}`, changeFrequency: "monthly" }));
}
```
Run: `git rm src/app/page.tsx`

- [ ] **Step 9: 빌드와 화면 확인**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: 빌드 성공. `/`, `/pricing`, `/terms`, `/privacy`, `/refund`가 Static(○)으로 표시.

Run: `pnpm dev` → Browser pane에서 375px 폭(`resize_window` mobile)으로 `/`, `/pricing`, `/privacy` 확인
Expected: 가로 스크롤 없음, 사업자 정보 미입력 항목이 노란 "[… 입력 필요]"로 표시됨.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add landing, pricing and legal pages"
```

---

### Task 15: 대시보드, 온보딩, 자동화 목록

**Files:**
- Create: `src/server/dashboard.ts`, `src/server/automations/service.ts`, `src/lib/event-labels.ts`
- Create: `src/app/app/onboarding/page.tsx`, `src/app/app/automations/page.tsx`, `src/app/app/automations/actions.ts`
- Create: `src/components/app/automation-toggle.tsx`, `src/components/app/event-list.tsx`, `src/components/app/reauth-banner.tsx`
- Modify: `src/app/app/page.tsx` (전체 교체)
- Test: `tests/integration/dashboard.test.ts`, `tests/integration/automation-service.test.ts`

**Interfaces:**
- Consumes: `getUserPlan`, `getDmUsage`, `errorReasonKo`, `requireUser`, 스키마
- Produces:
  - `getDashboard(db: Db, userId: string, now: Date): Promise<Dashboard>`
  - `getAutomationEvents(db: Db, userId: string, automationId: string, limit?: number)`
  - `type AutomationStats = { total; succeeded; partial; failed; pending; linksSent; linksClicked; clicks }`
  - `listAutomations(db, userId)`
  - `getAutomation(db, userId, id): Promise<Automation | null>`
  - `setAutomationActive(db, userId, id, active): Promise<ToggleResult>`
  - `deleteAutomation(db, userId, id): Promise<boolean>`
  - `type ToggleResult = { ok: true } | { ok: false; reason: "not_found" | "limit" | "account_inactive" }`
  - `STATUS_LABEL`, `SKIP_LABEL`
  - 서버 액션 `toggleAutomationAction(id, active)`, `deleteAutomationAction(id)`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/integration/automation-service.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { deleteAutomation, getAutomation, listAutomations, setAutomationActive } from "@/server/automations/service";
import { getDb } from "@/server/db/client";
import { resetDb } from "../helpers/db";
import { createAutomation, createIgAccount, createUser, setPlan } from "../helpers/factories";

describe("automation service", () => {
  beforeEach(resetDb);

  it("isolates automations per user", async () => {
    const a = await createUser();
    const b = await createUser();
    const acct = await createIgAccount(a.id);
    const auto = await createAutomation(acct);
    expect(await getAutomation(getDb(), b.id, auto.id)).toBeNull();
    expect(await setAutomationActive(getDb(), b.id, auto.id, false)).toEqual({ ok: false, reason: "not_found" });
    expect(await deleteAutomation(getDb(), b.id, auto.id)).toBe(false);
    expect(await listAutomations(getDb(), a.id)).toHaveLength(1);
  });

  it("enforces the free plan's single active automation", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createAutomation(acct, { isActive: true });
    const second = await createAutomation(acct, { isActive: false });
    expect(await setAutomationActive(getDb(), u.id, second.id, true)).toEqual({ ok: false, reason: "limit" });
    await setPlan(u.id, "pro");
    expect(await setAutomationActive(getDb(), u.id, second.id, true)).toEqual({ ok: true });
  });

  it("refuses to activate automations of disconnected accounts", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id, { status: "reauth_required" });
    const auto = await createAutomation(acct, { isActive: false });
    expect(await setAutomationActive(getDb(), u.id, auto.id, true)).toEqual({ ok: false, reason: "account_inactive" });
  });
});
```
`tests/integration/dashboard.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { links, usageCounters } from "@/server/db/schema";
import { getDashboard } from "@/server/dashboard";
import { usagePeriod } from "@/server/usage";
import { resetDb } from "../helpers/db";
import { createAutomation, createEvent, createIgAccount, createUser } from "../helpers/factories";

describe("getDashboard", () => {
  beforeEach(resetDb);

  it("aggregates per-automation stats, clicks, usage and waiting count", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const auto = await createAutomation(acct);
    const now = new Date();
    await createEvent(acct, { automationId: auto.id, status: "succeeded" });
    await createEvent(acct, { automationId: auto.id, status: "succeeded" });
    await createEvent(acct, { automationId: auto.id, status: "failed", errorCode: "551" });
    await createEvent(acct, { automationId: auto.id, status: "pending", runAt: new Date(now.getTime() + 60_000) });
    await createEvent(acct, { status: "skipped", skipReason: "no_match" });
    await getDb().insert(links).values([
      { code: "aaaaaaa", automationId: auto.id, targetUrl: "https://x", clickCount: 3 },
      { code: "bbbbbbb", automationId: auto.id, targetUrl: "https://x", clickCount: 0 },
    ]);
    await getDb().insert(usageCounters).values({ userId: u.id, period: usagePeriod(now), dmCount: 42 });

    const d = await getDashboard(getDb(), u.id, now);
    expect(d.plan.id).toBe("free");
    expect(d.usage).toBe(42);
    expect(d.waiting).toBe(1);
    expect(d.automations[0].stats).toEqual({ total: 4, succeeded: 2, partial: 0, failed: 1, pending: 1, linksSent: 2, linksClicked: 1, clicks: 3 });
    expect(d.recent).toHaveLength(4);
    expect(d.recent.every((r) => r.automationName === "공구 자동화")).toBe(true);
  });

  it("does not leak other users' data", async () => {
    const a = await createUser();
    const b = await createUser();
    const acct = await createIgAccount(a.id);
    const auto = await createAutomation(acct);
    await createEvent(acct, { automationId: auto.id, status: "succeeded" });
    const d = await getDashboard(getDb(), b.id, new Date());
    expect(d.automations).toHaveLength(0);
    expect(d.recent).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --project integration tests/integration/automation-service.test.ts tests/integration/dashboard.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `src/server/automations/service.ts` (조회·활성화·삭제)**

```ts
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { getUserPlan } from "@/server/billing/plan-of";
import type { Db } from "@/server/db/client";
import { automations, igAccounts, type Automation } from "@/server/db/schema";

export type ToggleResult = { ok: true } | { ok: false; reason: "not_found" | "limit" | "account_inactive" };

export async function listAutomations(db: Db, userId: string) {
  return db
    .select({
      id: automations.id,
      name: automations.name,
      isActive: automations.isActive,
      mediaScope: automations.mediaScope,
      mediaThumbnailUrl: automations.mediaThumbnailUrl,
      keywords: automations.keywords,
      igUsername: igAccounts.username,
      accountStatus: igAccounts.status,
      createdAt: automations.createdAt,
    })
    .from(automations)
    .innerJoin(igAccounts, eq(igAccounts.id, automations.igAccountId))
    .where(eq(automations.userId, userId))
    .orderBy(desc(automations.createdAt));
}

export async function getAutomation(db: Db, userId: string, id: string): Promise<Automation | null> {
  const [row] = await db
    .select()
    .from(automations)
    .where(and(eq(automations.id, id), eq(automations.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function setAutomationActive(db: Db, userId: string, id: string, active: boolean): Promise<ToggleResult> {
  const auto = await getAutomation(db, userId, id);
  if (!auto) return { ok: false, reason: "not_found" };
  if (!active) {
    await db.update(automations).set({ isActive: false }).where(eq(automations.id, id));
    return { ok: true };
  }
  const accounts = await db
    .select({ id: igAccounts.id, status: igAccounts.status })
    .from(igAccounts)
    .where(and(eq(igAccounts.userId, userId), ne(igAccounts.status, "disconnected")))
    .orderBy(asc(igAccounts.createdAt));
  const plan = await getUserPlan(db, userId);
  const index = accounts.findIndex((a) => a.id === auto.igAccountId);
  if (index === -1 || accounts[index].status !== "active") return { ok: false, reason: "account_inactive" };
  if (index >= plan.maxIgAccounts) return { ok: false, reason: "limit" };
  if (plan.maxActiveAutomations !== null) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(automations)
      .where(and(eq(automations.userId, userId), eq(automations.isActive, true), ne(automations.id, id)));
    if (count >= plan.maxActiveAutomations) return { ok: false, reason: "limit" };
  }
  await db.update(automations).set({ isActive: true }).where(eq(automations.id, id));
  return { ok: true };
}

export async function deleteAutomation(db: Db, userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(automations)
    .where(and(eq(automations.id, id), eq(automations.userId, userId)))
    .returning({ id: automations.id });
  return rows.length > 0;
}
```

- [ ] **Step 4: `src/server/dashboard.ts`**

```ts
import { and, desc, eq, gt, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Plan } from "@/lib/plans";
import { getUserPlan } from "@/server/billing/plan-of";
import type { Db } from "@/server/db/client";
import { automations, commentEvents, igAccounts, links } from "@/server/db/schema";
import { getDmUsage } from "@/server/usage";

export interface AutomationStats {
  total: number;
  succeeded: number;
  partial: number;
  failed: number;
  pending: number;
  linksSent: number;
  linksClicked: number;
  clicks: number;
}

const EMPTY: AutomationStats = { total: 0, succeeded: 0, partial: 0, failed: 0, pending: 0, linksSent: 0, linksClicked: 0, clicks: 0 };

const eventFields = {
  id: commentEvents.id,
  createdAt: commentEvents.createdAt,
  status: commentEvents.status,
  skipReason: commentEvents.skipReason,
  errorCode: commentEvents.errorCode,
  commenterUsername: commentEvents.commenterUsername,
  commentText: commentEvents.commentText,
  replyStatus: commentEvents.replyStatus,
  dmStatus: commentEvents.dmStatus,
  automationName: automations.name,
};

export type EventRow = Awaited<ReturnType<typeof getAutomationEvents>>[number];

async function statsByAutomation(db: Db, automationIds: string[]): Promise<Map<string, AutomationStats>> {
  const out = new Map<string, AutomationStats>();
  if (automationIds.length === 0) return out;
  const ev = await db
    .select({
      automationId: commentEvents.automationId,
      total: sql<number>`count(*)::int`,
      succeeded: sql<number>`(count(*) filter (where ${commentEvents.status} = 'succeeded'))::int`,
      partial: sql<number>`(count(*) filter (where ${commentEvents.status} = 'partial'))::int`,
      failed: sql<number>`(count(*) filter (where ${commentEvents.status} in ('failed', 'expired')))::int`,
      pending: sql<number>`(count(*) filter (where ${commentEvents.status} in ('pending', 'processing')))::int`,
    })
    .from(commentEvents)
    .where(inArray(commentEvents.automationId, automationIds))
    .groupBy(commentEvents.automationId);
  const lk = await db
    .select({
      automationId: links.automationId,
      linksSent: sql<number>`count(*)::int`,
      linksClicked: sql<number>`(count(*) filter (where ${links.clickCount} > 0))::int`,
      clicks: sql<number>`coalesce(sum(${links.clickCount}), 0)::int`,
    })
    .from(links)
    .where(inArray(links.automationId, automationIds))
    .groupBy(links.automationId);
  for (const id of automationIds) out.set(id, { ...EMPTY });
  for (const r of ev) {
    const s = r.automationId ? out.get(r.automationId) : undefined;
    if (s) Object.assign(s, { total: r.total, succeeded: r.succeeded, partial: r.partial, failed: r.failed, pending: r.pending });
  }
  for (const r of lk) {
    const s = r.automationId ? out.get(r.automationId) : undefined;
    if (s) Object.assign(s, { linksSent: r.linksSent, linksClicked: r.linksClicked, clicks: r.clicks });
  }
  return out;
}

export async function getDashboard(db: Db, userId: string, now: Date) {
  const plan: Plan = await getUserPlan(db, userId);
  const accounts = await db
    .select({ id: igAccounts.id, username: igAccounts.username, status: igAccounts.status, profilePictureUrl: igAccounts.profilePictureUrl })
    .from(igAccounts)
    .where(and(eq(igAccounts.userId, userId), ne(igAccounts.status, "disconnected")));
  const autos = await db
    .select({
      id: automations.id,
      name: automations.name,
      isActive: automations.isActive,
      mediaScope: automations.mediaScope,
      mediaThumbnailUrl: automations.mediaThumbnailUrl,
      keywords: automations.keywords,
    })
    .from(automations)
    .where(eq(automations.userId, userId))
    .orderBy(desc(automations.createdAt));
  const stats = await statsByAutomation(db, autos.map((a) => a.id));

  const [{ waiting }] = await db
    .select({ waiting: sql<number>`count(*)::int` })
    .from(commentEvents)
    .innerJoin(igAccounts, eq(igAccounts.id, commentEvents.igAccountId))
    .where(
      and(
        eq(igAccounts.userId, userId),
        eq(commentEvents.status, "pending"),
        isNotNull(commentEvents.automationId),
        gt(commentEvents.runAt, now),
      ),
    );

  const recent = await db
    .select(eventFields)
    .from(commentEvents)
    .innerJoin(automations, eq(automations.id, commentEvents.automationId))
    .where(eq(automations.userId, userId))
    .orderBy(desc(commentEvents.createdAt))
    .limit(20);

  return {
    plan,
    accounts,
    usage: await getDmUsage(db, userId, now),
    waiting,
    automations: autos.map((a) => ({ ...a, stats: stats.get(a.id) ?? { ...EMPTY } })),
    recent,
  };
}

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;

export async function getAutomationEvents(db: Db, userId: string, automationId: string, limit = 50) {
  return db
    .select(eventFields)
    .from(commentEvents)
    .innerJoin(automations, eq(automations.id, commentEvents.automationId))
    .where(and(eq(automations.userId, userId), eq(automations.id, automationId)))
    .orderBy(desc(commentEvents.createdAt))
    .limit(limit);
}

export async function getAutomationStats(db: Db, automationId: string): Promise<AutomationStats> {
  return (await statsByAutomation(db, [automationId])).get(automationId) ?? { ...EMPTY };
}
```
- [ ] **Step 5: 라벨 (`src/lib/event-labels.ts`)**

```ts
import type { EventStatus, SkipReason } from "@/server/db/schema";

export const STATUS_LABEL: Record<EventStatus, string> = {
  pending: "대기",
  processing: "처리 중",
  succeeded: "발송 완료",
  partial: "일부 발송",
  failed: "실패",
  skipped: "건너뜀",
  expired: "기한 만료",
};

export const SKIP_LABEL: Record<SkipReason, string> = {
  self: "본인 댓글",
  no_match: "키워드 불일치",
  duplicate: "이미 발송한 사용자",
  quota: "월 DM 한도 초과",
  account_inactive: "인스타 연결 끊김",
  automation_inactive: "자동화 꺼짐",
};

export const TOGGLE_ERROR: Record<"not_found" | "limit" | "account_inactive", string> = {
  not_found: "자동화를 찾을 수 없어요",
  limit: "현재 플랜에서 켤 수 있는 자동화 수를 넘었어요. 플랜을 업그레이드하거나 다른 자동화를 꺼주세요",
  account_inactive: "인스타 계정 연결을 먼저 확인해주세요",
};
```

- [ ] **Step 6: 서버 액션과 공용 컴포넌트**

`src/app/app/automations/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { deleteAutomation, setAutomationActive, type ToggleResult } from "@/server/automations/service";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";

const idSchema = z.uuid();

export async function toggleAutomationAction(id: string, active: boolean): Promise<ToggleResult> {
  const user = await requireUser();
  if (!idSchema.safeParse(id).success) return { ok: false, reason: "not_found" };
  const res = await setAutomationActive(getDb(), user.id, id, active);
  revalidatePath("/app");
  revalidatePath("/app/automations");
  return res;
}

export async function deleteAutomationAction(id: string): Promise<void> {
  const user = await requireUser();
  if (idSchema.safeParse(id).success) await deleteAutomation(getDb(), user.id, id);
  revalidatePath("/app");
  redirect("/app/automations");
}
```
`src/components/app/automation-toggle.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { toggleAutomationAction } from "@/app/app/automations/actions";
import { Switch } from "@/components/ui/switch";
import { TOGGLE_ERROR } from "@/lib/event-labels";

export function AutomationToggle({ id, active, label }: { id: string; active: boolean; label: string }) {
  const [checked, setChecked] = useState(active);
  const [pending, startTransition] = useTransition();
  return (
    <Switch
      checked={checked}
      disabled={pending}
      aria-label={`${label} ${checked ? "끄기" : "켜기"}`}
      onCheckedChange={(next) =>
        startTransition(async () => {
          setChecked(next);
          const res = await toggleAutomationAction(id, next);
          if (!res.ok) {
            setChecked(!next);
            toast.error(TOGGLE_ERROR[res.reason]);
          } else {
            toast.success(next ? "자동화를 켰어요" : "자동화를 껐어요");
          }
        })
      }
    />
  );
}
```
`src/components/app/event-list.tsx`:
```tsx
import { Badge } from "@/components/ui/badge";
import { SKIP_LABEL, STATUS_LABEL } from "@/lib/event-labels";
import type { EventRow } from "@/server/dashboard";
import { errorReasonKo } from "@/server/instagram/errors";

const VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  succeeded: "default",
  partial: "secondary",
  failed: "destructive",
  expired: "destructive",
  pending: "outline",
  processing: "outline",
  skipped: "outline",
};

const time = (d: Date) =>
  d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function EventList({ events, showAutomation = true }: { events: EventRow[]; showAutomation?: boolean }) {
  if (events.length === 0) {
    return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">아직 발송 기록이 없어요</p>;
  }
  return (
    <ul className="divide-y rounded-lg border bg-background">
      {events.map((e) => {
        const reason = e.status === "skipped" && e.skipReason ? SKIP_LABEL[e.skipReason] : errorReasonKo(e.errorCode);
        return (
          <li key={e.id} className="flex items-start justify-between gap-3 p-3 text-sm">
            <div className="min-w-0">
              <p className="truncate">
                <span className="font-medium">@{e.commenterUsername ?? "알 수 없음"}</span>{" "}
                <span className="text-muted-foreground">{e.commentText}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {time(e.createdAt)}
                {showAutomation && ` · ${e.automationName}`}
                {reason && ` · ${reason}`}
              </p>
            </div>
            <Badge variant={VARIANT[e.status] ?? "outline"} className="shrink-0">
              {STATUS_LABEL[e.status]}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
```
`src/components/app/reauth-banner.tsx`:
```tsx
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ReauthBanner({ accounts }: { accounts: { username: string; status: string }[] }) {
  const broken = accounts.filter((a) => a.status === "reauth_required");
  if (broken.length === 0) return null;
  return (
    <Alert variant="destructive">
      <AlertTriangle className="size-4" />
      <AlertTitle>인스타그램 연결이 끊겼어요</AlertTitle>
      <AlertDescription>
        {broken.map((a) => `@${a.username}`).join(", ")} 계정의 자동 응답이 멈췄어요.{" "}
        <a href="/api/instagram/connect" className="font-semibold underline">
          다시 연결하기
        </a>
      </AlertDescription>
    </Alert>
  );
}
```

- [ ] **Step 7: 대시보드 페이지 (`src/app/app/page.tsx` 교체)**

```tsx
import { Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EventList } from "@/components/app/event-list";
import { ReauthBanner } from "@/components/app/reauth-banner";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { getDb } from "@/server/db/client";
import { getDashboard } from "@/server/dashboard";
import { requireUser } from "@/server/session";

export const metadata = { title: "대시보드" };

export default async function DashboardPage() {
  const user = await requireUser();
  const d = await getDashboard(getDb(), user.id, new Date());
  if (d.accounts.length === 0) redirect("/app/onboarding");
  const usagePct = Math.min(100, Math.round((d.usage / d.plan.monthlyDmLimit) * 100));

  return (
    <div className="space-y-6">
      <ReauthBanner accounts={d.accounts} />
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>이번 달 DM · {d.plan.name}</CardDescription>
            <CardTitle className="text-2xl">
              {d.usage.toLocaleString()}
              <span className="text-sm font-normal text-muted-foreground"> / {d.plan.monthlyDmLimit.toLocaleString()}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={usagePct} aria-label="이번 달 DM 사용량" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>발송 대기</CardDescription>
            <CardTitle className="text-2xl">{d.waiting.toLocaleString()}건</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">발송 한도에 맞춰 순서대로 보내요</CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">자동화</h2>
          <Link href="/app/automations/new" className={buttonVariants({ size: "sm" })}>
            <Plus className="size-4" /> 새 자동화
          </Link>
        </div>
        {d.automations.length === 0 ? (
          <Link
            href="/app/automations/new"
            className="block rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
          >
            첫 자동화를 만들어보세요
          </Link>
        ) : (
          <ul className="space-y-3">
            {d.automations.map((a) => (
              <li key={a.id}>
                <Link href={`/app/automations/${a.id}`} className="block rounded-lg border bg-background p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{a.name}</p>
                    <span className={cn("text-xs", a.isActive ? "text-green-600" : "text-muted-foreground")}>
                      {a.isActive ? "● 켜짐" : "○ 꺼짐"}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">키워드: {a.keywords.join(", ")}</p>
                  <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                    {[
                      ["트리거", a.stats.total],
                      ["성공", a.stats.succeeded + a.stats.partial],
                      ["실패", a.stats.failed],
                      [d.plan.linkTracking ? "클릭" : "대기", d.plan.linkTracking ? a.stats.clicks : a.stats.pending],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-md bg-muted/60 py-2">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="text-base font-semibold">{Number(v).toLocaleString()}</dd>
                      </div>
                    ))}
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">최근 발송</h2>
        <EventList events={d.recent} />
      </section>
    </div>
  );
}
```

- [ ] **Step 8: 온보딩 (`src/app/app/onboarding/page.tsx`)**

```tsx
import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { listAutomations } from "@/server/automations/service";
import { getDb } from "@/server/db/client";
import { getDashboard } from "@/server/dashboard";
import { requireUser } from "@/server/session";

export const metadata = { title: "시작하기" };

const ERRORS: Record<string, string> = {
  denied: "인스타그램 연결을 취소했어요.",
  state: "보안 확인에 실패했어요. 다시 시도해주세요.",
  oauth_failed: "인스타그램 인증에 실패했어요. 잠시 후 다시 시도해주세요.",
  not_professional: "비즈니스 또는 크리에이터 계정만 연결할 수 있어요. 아래 가이드대로 전환한 뒤 다시 연결해주세요.",
  owned_by_other: "이미 다른 회원이 연결한 인스타그램 계정이에요.",
  limit: "현재 플랜에서 연결할 수 있는 인스타그램 계정 수를 넘었어요.",
  subscribe_failed: "댓글 알림 구독에 실패했어요. 다시 연결해주세요.",
};

function Step({ done, title, children }: { done: boolean; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3 space-y-0">
        {done ? <CheckCircle2 className="size-5 text-green-600" /> : <Circle className="size-5 text-muted-foreground" />}
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">{children}</CardContent>
    </Card>
  );
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const d = await getDashboard(getDb(), user.id, new Date());
  const autos = await listAutomations(getDb(), user.id);
  const connected = d.accounts.some((a) => a.status === "active");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">3단계로 시작해요</h1>
      {sp.error && ERRORS[sp.error] && (
        <Alert variant="destructive">
          <AlertDescription>{ERRORS[sp.error]}</AlertDescription>
        </Alert>
      )}
      {sp.connected && (
        <Alert>
          <AlertDescription>인스타그램 계정이 연결됐어요!</AlertDescription>
        </Alert>
      )}

      <Step done={connected} title="1. 프로페셔널 계정 준비">
        <p className="text-muted-foreground">인스타그램 정책상 비즈니스 또는 크리에이터 계정만 연결할 수 있어요. 계정은 공개 상태여야 댓글 알림을 받을 수 있어요.</p>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>인스타그램 앱 → 프로필 → 오른쪽 위 메뉴(≡)</li>
          <li>설정 및 활동 → 계정 유형 및 도구 → 프로페셔널 계정으로 전환</li>
          <li>크리에이터 또는 비즈니스 선택 (무료)</li>
          <li>설정 → 메시지 및 스토리 답장 → 메시지 요청 → 연결된 도구에서 메시지 접근 허용 켜기</li>
        </ol>
      </Step>

      <Step done={connected} title="2. 인스타그램 연결">
        {d.accounts.length > 0 && (
          <ul className="space-y-1">
            {d.accounts.map((a) => (
              <li key={a.id}>
                @{a.username} {a.status === "active" ? "· 연결됨" : "· 다시 연결 필요"}
              </li>
            ))}
          </ul>
        )}
        <a href="/api/instagram/connect" className={cn(buttonVariants({ variant: connected ? "outline" : "default" }), "w-full")}>
          {connected ? "다른 계정 연결 / 다시 연결" : "인스타그램으로 연결하기"}
        </a>
        <p className="text-xs text-muted-foreground">인스타그램 공식 로그인 창으로 이동해요. 비밀번호는 저장하지 않아요.</p>
      </Step>

      <Step done={autos.length > 0} title="3. 첫 자동화 만들기">
        <Link
          href="/app/automations/new"
          aria-disabled={!connected}
          className={cn(buttonVariants(), "w-full", !connected && "pointer-events-none opacity-50")}
        >
          자동화 만들기
        </Link>
      </Step>
    </div>
  );
}
```

- [ ] **Step 9: 자동화 목록 (`src/app/app/automations/page.tsx`)**

```tsx
import { Plus } from "lucide-react";
import Link from "next/link";
import { AutomationToggle } from "@/components/app/automation-toggle";
import { buttonVariants } from "@/components/ui/button";
import { listAutomations } from "@/server/automations/service";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";

export const metadata = { title: "자동화" };

const SCOPE: Record<string, string> = { specific: "특정 게시물", all: "모든 게시물", next: "다음 게시물" };

export default async function AutomationsPage() {
  const user = await requireUser();
  const autos = await listAutomations(getDb(), user.id);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">자동화</h1>
        <Link href="/app/automations/new" className={buttonVariants({ size: "sm" })}>
          <Plus className="size-4" /> 새 자동화
        </Link>
      </div>
      {autos.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">아직 자동화가 없어요</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-background">
          {autos.map((a) => (
            <li key={a.id} className="flex items-center gap-3 p-4">
              {a.mediaThumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.mediaThumbnailUrl} alt="" className="size-12 shrink-0 rounded-md object-cover" />
              ) : (
                <div className="size-12 shrink-0 rounded-md bg-muted" />
              )}
              <Link href={`/app/automations/${a.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium">{a.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  @{a.igUsername} · {SCOPE[a.mediaScope]} · {a.keywords.join(", ")}
                </p>
              </Link>
              <AutomationToggle id={a.id} active={a.isActive} label={a.name} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 10: 통과 확인**

Run: `pnpm vitest run --project integration tests/integration/automation-service.test.ts tests/integration/dashboard.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS, 오류 없음

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add dashboard, onboarding and automation list with plan-aware toggling"
```

---

### Task 16: 자동화 생성·수정 위자드

**Files:**
- Create: `src/lib/automation-schema.ts`
- Modify: `src/server/automations/service.ts` (create/update 추가), `src/app/app/automations/actions.ts` (save 추가)
- Create: `src/components/app/automation-wizard.tsx`, `src/components/app/media-picker.tsx`, `src/components/app/message-preview.tsx`, `src/components/app/delete-automation-button.tsx`
- Create: `src/app/app/automations/new/page.tsx`, `src/app/app/automations/[id]/page.tsx`, `src/app/app/automations/[id]/edit/page.tsx`
- Test: `tests/unit/automation-schema.test.ts`, `tests/integration/automation-save.test.ts`

**Interfaces:**
- Consumes: `setAutomationActive`, `getAutomation`, `getAutomationEvents`, `getAutomationStats`, `EventList`, `AutomationToggle`, `/api/instagram/media`
- Produces:
  - `automationInputSchema`, `type AutomationInput`, `REPLY_MAX`, `DM_TEXT_MAX`, `BUTTON_TITLE_MAX`
  - `createAutomation(db, userId, input, opts: { appUrl: string; activate: boolean }): Promise<SaveResult>`
  - `updateAutomation(db, userId, id, input, opts): Promise<SaveResult>`
  - `type SaveResult = { ok: true; id: string; activated: boolean; activationError?: "limit" | "account_inactive" } | { ok: false; error: string }`
  - `saveAutomationAction(input: unknown, opts: { id?: string; activate: boolean }): Promise<SaveResult>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/unit/automation-schema.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { automationInputSchema } from "@/lib/automation-schema";

const valid = {
  igAccountId: "5f0c7c1e-1d2b-4c3a-9e8f-0a1b2c3d4e5f",
  name: "공구 자동화",
  mediaScope: "all" as const,
  media: null,
  keywords: ["공구"],
  matchType: "contains" as const,
  replyEnabled: true,
  replyTexts: ["{username} DM 확인해주세요!"],
  dmText: "구매 링크 보내드려요",
  dmButtonTitle: "구매하기",
  dmLinkUrl: "https://shop.example.com/p/1",
};

const issues = (input: unknown) => {
  const r = automationInputSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("automationInputSchema", () => {
  it("accepts a valid automation", () => {
    expect(automationInputSchema.safeParse(valid).success).toBe(true);
  });
  it("requires https links", () => {
    expect(issues({ ...valid, dmLinkUrl: "http://shop.example.com" })).toContain("https:// 로 시작하는 링크를 입력해주세요");
  });
  it("forbids links and too many hashtags in public replies", () => {
    expect(issues({ ...valid, replyTexts: ["여기 www.x.com"] })).toContain("공개 답글에는 링크를 넣을 수 없어요");
    expect(issues({ ...valid, replyTexts: ["#a #b #c #d #e"] })).toContain("해시태그는 4개까지 넣을 수 있어요");
  });
  it("requires a media selection for specific scope", () => {
    expect(issues({ ...valid, mediaScope: "specific" })).toContain("게시물을 선택해주세요");
  });
  it("requires reply texts when replies are enabled", () => {
    expect(issues({ ...valid, replyTexts: [] })).toContain("답글 문구를 1개 이상 입력해주세요");
    expect(automationInputSchema.safeParse({ ...valid, replyEnabled: false, replyTexts: [] }).success).toBe(true);
  });
  it("allows no keywords only for the 'any' match type", () => {
    const parsed = automationInputSchema.safeParse({ ...valid, matchType: "any", keywords: [] });
    expect(parsed.success).toBe(true);
  });
  it("requires at least one keyword and caps lengths", () => {
    expect(issues({ ...valid, keywords: [] })).toContain("키워드를 1개 이상 입력해주세요");
    expect(automationInputSchema.safeParse({ ...valid, dmButtonTitle: "가".repeat(21) }).success).toBe(false);
    expect(automationInputSchema.safeParse({ ...valid, dmText: "가".repeat(601) }).success).toBe(false);
  });
});
```
`tests/integration/automation-save.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { AutomationInput } from "@/lib/automation-schema";
import { createAutomation, getAutomation, updateAutomation } from "@/server/automations/service";
import { getDb } from "@/server/db/client";
import { resetDb } from "../helpers/db";
import { createAutomation as seedAutomation, createIgAccount, createUser } from "../helpers/factories";

const opts = { appUrl: "https://app.test", activate: true };

function input(igAccountId: string, overrides: Partial<AutomationInput> = {}): AutomationInput {
  return {
    igAccountId,
    name: "공구",
    mediaScope: "specific",
    media: { id: "m1", thumbnailUrl: "https://t", permalink: "https://p", caption: "캡션" },
    keywords: ["공구", " 공구 ", "링크"],
    matchType: "contains",
    replyEnabled: true,
    replyTexts: ["DM 확인!"],
    dmText: "링크",
    dmButtonTitle: "구매",
    dmLinkUrl: "https://shop.example.com",
    ...overrides,
  };
}

describe("create/update automation", () => {
  beforeEach(resetDb);

  it("creates an active automation with deduped keywords and media fields", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const res = await createAutomation(getDb(), u.id, input(acct.id), opts);
    expect(res).toMatchObject({ ok: true, activated: true });
    if (!res.ok) throw new Error("unreachable");
    const row = await getAutomation(getDb(), u.id, res.id);
    expect(row).toMatchObject({ keywords: ["공구", "링크"], mediaId: "m1", mediaPermalink: "https://p", isActive: true });
  });

  it("saves but does not activate beyond the free plan limit", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await seedAutomation(acct, { isActive: true });
    const res = await createAutomation(getDb(), u.id, input(acct.id), opts);
    expect(res).toMatchObject({ ok: true, activated: false, activationError: "limit" });
  });

  it("rejects another user's account and self short links", async () => {
    const owner = await createUser();
    const acct = await createIgAccount(owner.id);
    const intruder = await createUser();
    expect((await createAutomation(getDb(), intruder.id, input(acct.id), opts)).ok).toBe(false);
    const res = await createAutomation(getDb(), owner.id, input(acct.id, { dmLinkUrl: "https://app.test/l/abc1234" }), opts);
    expect(res).toEqual({ ok: false, error: "이 서비스의 단축 링크는 넣을 수 없어요" });
  });

  it("updates fields and clears media when switching to all posts", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    const created = await createAutomation(getDb(), u.id, input(acct.id), opts);
    if (!created.ok) throw new Error("unreachable");
    const res = await updateAutomation(getDb(), u.id, created.id, input(acct.id, { mediaScope: "all", media: null, name: "전체" }), { ...opts, activate: false });
    expect(res.ok).toBe(true);
    const row = await getAutomation(getDb(), u.id, created.id);
    expect(row).toMatchObject({ name: "전체", mediaScope: "all", mediaId: null, isActive: false });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --project unit tests/unit/automation-schema.test.ts; pnpm vitest run --project integration tests/integration/automation-save.test.ts`
Expected: FAIL — 모듈·함수 없음

- [ ] **Step 3: `src/lib/automation-schema.ts`**

```ts
import { z } from "zod";

export const KEYWORD_MAX = 30;
export const REPLY_MAX = 300;
export const DM_TEXT_MAX = 600;
export const BUTTON_TITLE_MAX = 20;

const URL_IN_TEXT = /(https?:\/\/|www\.)\S+/i;

const replyText = z
  .string()
  .trim()
  .min(1, "빈 답글 문구가 있어요")
  .max(REPLY_MAX, `답글은 ${REPLY_MAX}자까지 쓸 수 있어요`)
  .refine((t) => !URL_IN_TEXT.test(t), "공개 답글에는 링크를 넣을 수 없어요")
  .refine((t) => (t.match(/#[^\s#]+/g) ?? []).length <= 4, "해시태그는 4개까지 넣을 수 있어요");

export const automationInputSchema = z
  .object({
    igAccountId: z.uuid({ error: "인스타 계정을 선택해주세요" }),
    name: z.string().trim().min(1, "이름을 입력해주세요").max(50, "이름은 50자까지 쓸 수 있어요"),
    mediaScope: z.enum(["specific", "all", "next"]),
    media: z
      .object({
        id: z.string().min(1),
        thumbnailUrl: z.string().nullable(),
        permalink: z.string().nullable(),
        caption: z.string().nullable(),
      })
      .nullable(),
    keywords: z
      .array(z.string().trim().min(1).max(KEYWORD_MAX, `키워드는 ${KEYWORD_MAX}자까지 쓸 수 있어요`))
      .max(10, "키워드는 10개까지 넣을 수 있어요"),
    matchType: z.enum(["contains", "exact", "any"]),
    replyEnabled: z.boolean(),
    replyTexts: z.array(replyText).max(5, "답글 문구는 5개까지 넣을 수 있어요"),
    dmText: z.string().trim().min(1, "DM 내용을 입력해주세요").max(DM_TEXT_MAX, `DM은 ${DM_TEXT_MAX}자까지 쓸 수 있어요`),
    dmButtonTitle: z
      .string()
      .trim()
      .min(1, "버튼 문구를 입력해주세요")
      .max(BUTTON_TITLE_MAX, `버튼 문구는 ${BUTTON_TITLE_MAX}자까지 쓸 수 있어요`),
    dmLinkUrl: z.url({ protocol: /^https$/, error: "https:// 로 시작하는 링크를 입력해주세요" }),
  })
  .superRefine((v, ctx) => {
    if (v.mediaScope === "specific" && !v.media) {
      ctx.addIssue({ code: "custom", path: ["media"], message: "게시물을 선택해주세요" });
    }
    if (v.replyEnabled && v.replyTexts.length === 0) {
      ctx.addIssue({ code: "custom", path: ["replyTexts"], message: "답글 문구를 1개 이상 입력해주세요" });
    }
    if (v.matchType !== "any" && v.keywords.length === 0) {
      ctx.addIssue({ code: "custom", path: ["keywords"], message: "키워드를 1개 이상 입력해주세요" });
    }
  });

export type AutomationInput = z.infer<typeof automationInputSchema>;
```

- [ ] **Step 4: service에 create/update 추가 (`src/server/automations/service.ts` 끝에 추가)**

```ts
// (파일 상단 import에 추가)
// import type { AutomationInput } from "@/lib/automation-schema";
// import { normalizeText } from "./matcher";

export type SaveResult =
  | { ok: true; id: string; activated: boolean; activationError?: "limit" | "account_inactive" }
  | { ok: false; error: string };

function isSelfShortLink(url: string, appUrl: string): boolean {
  try {
    const u = new URL(url);
    return u.host === new URL(appUrl).host && u.pathname.startsWith("/l/");
  } catch {
    return false;
  }
}

function dedupeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keywords) {
    const trimmed = k.trim();
    const key = normalizeText(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function toColumns(input: AutomationInput) {
  const specific = input.mediaScope === "specific" && input.media;
  return {
    igAccountId: input.igAccountId,
    name: input.name,
    mediaScope: input.mediaScope,
    mediaId: specific ? input.media!.id : null,
    mediaThumbnailUrl: specific ? input.media!.thumbnailUrl : null,
    mediaPermalink: specific ? input.media!.permalink : null,
    mediaCaption: specific ? input.media!.caption : null,
    keywords: dedupeKeywords(input.keywords),
    matchType: input.matchType,
    replyEnabled: input.replyEnabled,
    replyTexts: input.replyEnabled ? input.replyTexts : [],
    dmText: input.dmText,
    dmButtonTitle: input.dmButtonTitle,
    dmLinkUrl: input.dmLinkUrl,
  };
}

async function validateOwnership(db: Db, userId: string, input: AutomationInput, appUrl: string): Promise<string | null> {
  const [acct] = await db
    .select({ id: igAccounts.id })
    .from(igAccounts)
    .where(and(eq(igAccounts.id, input.igAccountId), eq(igAccounts.userId, userId), ne(igAccounts.status, "disconnected")))
    .limit(1);
  if (!acct) return "인스타 계정을 찾을 수 없어요";
  if (isSelfShortLink(input.dmLinkUrl, appUrl)) return "이 서비스의 단축 링크는 넣을 수 없어요";
  return null;
}

async function applyActivation(db: Db, userId: string, id: string, activate: boolean): Promise<SaveResult> {
  const res = await setAutomationActive(db, userId, id, activate);
  if (res.ok) return { ok: true, id, activated: activate };
  if (res.reason === "not_found") return { ok: false, error: "자동화를 찾을 수 없어요" };
  return { ok: true, id, activated: false, activationError: res.reason };
}

export async function createAutomation(
  db: Db,
  userId: string,
  input: AutomationInput,
  opts: { appUrl: string; activate: boolean },
): Promise<SaveResult> {
  const error = await validateOwnership(db, userId, input, opts.appUrl);
  if (error) return { ok: false, error };
  const [row] = await db
    .insert(automations)
    .values({ userId, ...toColumns(input), isActive: false })
    .returning({ id: automations.id });
  return applyActivation(db, userId, row.id, opts.activate);
}

export async function updateAutomation(
  db: Db,
  userId: string,
  id: string,
  input: AutomationInput,
  opts: { appUrl: string; activate: boolean },
): Promise<SaveResult> {
  const error = await validateOwnership(db, userId, input, opts.appUrl);
  if (error) return { ok: false, error };
  const rows = await db
    .update(automations)
    .set(toColumns(input))
    .where(and(eq(automations.id, id), eq(automations.userId, userId)))
    .returning({ id: automations.id });
  if (rows.length === 0) return { ok: false, error: "자동화를 찾을 수 없어요" };
  return applyActivation(db, userId, id, opts.activate);
}
```
파일 상단 import에 `import type { AutomationInput } from "@/lib/automation-schema";`와 `import { normalizeText } from "./matcher";`를 추가한다.

- [ ] **Step 5: 저장 액션 (`src/app/app/automations/actions.ts`에 추가)**

```ts
// 상단 import에 추가:
// import { automationInputSchema } from "@/lib/automation-schema";
// import { createAutomation, updateAutomation, type SaveResult } from "@/server/automations/service";
// import { getEnv } from "@/server/env";

export async function saveAutomationAction(
  raw: unknown,
  opts: { id?: string; activate: boolean },
): Promise<SaveResult> {
  const user = await requireUser();
  const parsed = automationInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요" };
  const appUrl = getEnv().APP_URL;
  const res =
    opts.id && idSchema.safeParse(opts.id).success
      ? await updateAutomation(getDb(), user.id, opts.id, parsed.data, { appUrl, activate: opts.activate })
      : await createAutomation(getDb(), user.id, parsed.data, { appUrl, activate: opts.activate });
  revalidatePath("/app");
  revalidatePath("/app/automations");
  return res;
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm vitest run --project unit tests/unit/automation-schema.test.ts && pnpm vitest run --project integration tests/integration/automation-save.test.ts`
Expected: PASS

- [ ] **Step 7: 게시물 선택기 (`src/components/app/media-picker.tsx`)**

```tsx
"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PickedMedia {
  id: string;
  thumbnailUrl: string | null;
  permalink: string | null;
  caption: string | null;
}

interface Item extends PickedMedia {
  mediaType: string | null;
  timestamp: string | null;
}

export function MediaPicker({
  accountId,
  value,
  onChange,
}: {
  accountId: string;
  value: PickedMedia | null;
  onChange: (m: PickedMedia) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (after?: string) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ accountId, ...(after ? { after } : {}) });
        const res = await fetch(`/api/instagram/media?${qs}`);
        const body = (await res.json()) as { items?: Item[]; nextCursor?: string | null; error?: string };
        if (!res.ok) throw new Error(body.error ?? "게시물을 불러오지 못했어요");
        setItems((prev) => (after ? [...prev, ...(body.items ?? [])] : (body.items ?? [])));
        setCursor(body.nextCursor ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "게시물을 불러오지 못했어요");
      } finally {
        setLoading(false);
      }
    },
    [accountId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="grid grid-cols-3 gap-1.5">
        {items.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange({ id: m.id, thumbnailUrl: m.thumbnailUrl, permalink: m.permalink, caption: m.caption })}
            className={cn(
              "relative aspect-square overflow-hidden rounded-md bg-muted outline-none ring-offset-2 focus-visible:ring-2",
              value?.id === m.id && "ring-2 ring-foreground",
            )}
            aria-pressed={value?.id === m.id}
            aria-label={m.caption ?? "게시물"}
          >
            {m.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.thumbnailUrl} alt="" className="size-full object-cover" loading="lazy" />
            ) : (
              <span className="p-1 text-[10px] text-muted-foreground">{m.caption ?? "미리보기 없음"}</span>
            )}
          </button>
        ))}
      </div>
      {loading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
      {!loading && cursor && (
        <Button type="button" variant="outline" className="w-full" onClick={() => load(cursor)}>
          더 보기
        </Button>
      )}
      {!loading && !error && items.length === 0 && <p className="text-center text-sm text-muted-foreground">게시물이 없어요</p>}
    </div>
  );
}
```

- [ ] **Step 8: 미리보기 (`src/components/app/message-preview.tsx`)**

```tsx
export function MessagePreview({
  keyword,
  reply,
  dmText,
  buttonTitle,
  branding,
}: {
  keyword: string;
  reply: string | null;
  dmText: string;
  buttonTitle: string;
  branding: string | null;
}) {
  return (
    <div className="space-y-4 rounded-xl border bg-background p-4 text-sm">
      <div>
        <p className="text-xs text-muted-foreground">댓글</p>
        <p className="mt-1">
          <span className="font-semibold">follower_ji</span> {keyword || "키워드"}
        </p>
        {reply && (
          <p className="mt-1 pl-4">
            <span className="font-semibold">나</span> {reply.replaceAll("{username}", "@follower_ji")}
          </p>
        )}
      </div>
      <div>
        <p className="text-xs text-muted-foreground">DM</p>
        <div className="mt-1 max-w-[85%] rounded-2xl bg-muted p-3">
          <p className="whitespace-pre-wrap">{dmText || "DM 내용"}</p>
          {branding && <p className="mt-2 text-xs text-muted-foreground">{branding}</p>}
          <div className="mt-2 rounded-lg bg-background py-2 text-center font-semibold">{buttonTitle || "버튼"}</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: 위자드 (`src/components/app/automation-wizard.tsx`)**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveAutomationAction } from "@/app/app/automations/actions";
import { MediaPicker, type PickedMedia } from "@/components/app/media-picker";
import { MessagePreview } from "@/components/app/message-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BUTTON_TITLE_MAX, DM_TEXT_MAX, REPLY_MAX, type AutomationInput } from "@/lib/automation-schema";
import { TOGGLE_ERROR } from "@/lib/event-labels";

export interface WizardAccount {
  id: string;
  username: string;
}

type Draft = Omit<AutomationInput, "media"> & { media: PickedMedia | null };

const STEPS = ["게시물", "키워드", "공개 답글", "DM", "확인"] as const;

const DEFAULT_REPLIES = ["{username} DM 확인해주세요! 💌", "{username} DM으로 보내드렸어요 🙌", "{username} 메시지함을 확인해주세요 😊"];

export function AutomationWizard({
  accounts,
  initial,
  automationId,
  branding,
}: {
  accounts: WizardAccount[];
  initial?: Draft;
  automationId?: string;
  branding: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [keywordInput, setKeywordInput] = useState("");
  const [draft, setDraft] = useState<Draft>(
    initial ?? {
      igAccountId: accounts[0]?.id ?? "",
      name: "",
      mediaScope: "specific",
      media: null,
      keywords: [],
      matchType: "contains",
      replyEnabled: true,
      replyTexts: DEFAULT_REPLIES,
      dmText: "",
      dmButtonTitle: "링크 열기",
      dmLinkUrl: "https://",
    },
  );
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  function stepError(i: number): string | null {
    if (i === 0) {
      if (!draft.igAccountId) return "인스타 계정을 선택해주세요";
      if (draft.mediaScope === "specific" && !draft.media) return "게시물을 선택해주세요";
    }
    if (i === 1 && draft.matchType !== "any" && draft.keywords.length === 0) return "키워드를 1개 이상 입력해주세요";
    if (i === 2 && draft.replyEnabled && draft.replyTexts.filter((t) => t.trim()).length === 0) return "답글 문구를 1개 이상 입력해주세요";
    if (i === 3) {
      if (!draft.dmText.trim()) return "DM 내용을 입력해주세요";
      if (!draft.dmButtonTitle.trim()) return "버튼 문구를 입력해주세요";
      if (!/^https:\/\/\S+\.\S+/.test(draft.dmLinkUrl)) return "https:// 로 시작하는 링크를 입력해주세요";
    }
    if (i === 4 && !draft.name.trim()) return "자동화 이름을 입력해주세요";
    return null;
  }

  function next() {
    const err = stepError(step);
    if (err) return toast.error(err);
    if (step === 3 && !draft.name.trim()) set("name", `${draft.keywords[0] ?? "새"} 자동화`);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function addKeyword() {
    const k = keywordInput.trim();
    if (!k) return;
    if (draft.keywords.length >= 10) return toast.error("키워드는 10개까지 넣을 수 있어요");
    if (!draft.keywords.includes(k)) set("keywords", [...draft.keywords, k]);
    setKeywordInput("");
  }

  function save(activate: boolean) {
    const err = stepError(4);
    if (err) return toast.error(err);
    startTransition(async () => {
      const payload = { ...draft, replyTexts: draft.replyTexts.map((t) => t.trim()).filter(Boolean) };
      const res = await saveAutomationAction(payload, { id: automationId, activate });
      if (!res.ok) return void toast.error(res.error);
      if (activate && !res.activated && res.activationError) toast.warning(`저장했지만 켜지 못했어요. ${TOGGLE_ERROR[res.activationError]}`);
      else toast.success(activate ? "자동화를 켰어요!" : "저장했어요");
      router.push(`/app/automations/${res.id}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {step + 1} / {STEPS.length} · {STEPS[step]}
          </span>
        </div>
        <Progress value={((step + 1) / STEPS.length) * 100} />
      </div>

      {step === 0 && (
        <section className="space-y-5">
          {accounts.length > 1 && (
            <div className="space-y-2">
              <Label>인스타 계정</Label>
              <RadioGroup value={draft.igAccountId} onValueChange={(v) => setDraft((d) => ({ ...d, igAccountId: v, media: null }))}>
                {accounts.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value={a.id} /> @{a.username}
                  </label>
                ))}
              </RadioGroup>
            </div>
          )}
          <div className="space-y-2">
            <Label>어떤 게시물의 댓글에 반응할까요?</Label>
            <RadioGroup value={draft.mediaScope} onValueChange={(v) => set("mediaScope", v as Draft["mediaScope"])}>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="specific" /> 특정 게시물·릴스
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="next" /> 다음에 올릴 게시물
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="all" /> 모든 게시물
              </label>
            </RadioGroup>
          </div>
          {draft.mediaScope === "specific" && draft.igAccountId && (
            <MediaPicker accountId={draft.igAccountId} value={draft.media} onChange={(m) => set("media", m)} />
          )}
          {draft.mediaScope === "next" && (
            <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">지금 이후 처음 올라오는 게시물·릴스에 자동으로 연결돼요.</p>
          )}
        </section>
      )}

      {step === 1 && (
        <section className="space-y-5">
          <div className="space-y-2">
            <Label>어떤 댓글에 반응할까요?</Label>
            <RadioGroup value={draft.matchType} onValueChange={(v) => set("matchType", v as Draft["matchType"])}>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="contains" /> 키워드가 들어간 댓글 — &ldquo;공구요!&rdquo;, &ldquo;@친구 공구&rdquo;도 반응
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="exact" /> 키워드만 있는 댓글 — 끝의 이모지·문장부호는 무시
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="any" /> 모든 댓글 — 키워드 없이 댓글 단 모든 사람에게 (같은 사람에게는 한 번)
              </label>
            </RadioGroup>
          </div>
          {draft.matchType !== "any" && (
          <div className="space-y-2">
            <Label htmlFor="kw">트리거 키워드</Label>
            <div className="flex gap-2">
              <Input
                id="kw"
                value={keywordInput}
                placeholder="예: 공구, 링크"
                maxLength={30}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    addKeyword();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addKeyword}>
                추가
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {draft.keywords.map((k) => (
                <Badge key={k} variant="secondary" className="gap-1">
                  {k}
                  <button type="button" aria-label={`${k} 삭제`} onClick={() => set("keywords", draft.keywords.filter((x) => x !== k))}>
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          </div>
          )}
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4">
          <label className="flex items-center justify-between">
            <span className="text-sm font-medium">댓글에 공개 답글 달기</span>
            <Switch checked={draft.replyEnabled} onCheckedChange={(v) => set("replyEnabled", v)} />
          </label>
          {draft.replyEnabled && (
            <>
              <p className="text-xs text-muted-foreground">
                같은 문구를 반복하면 스팸으로 보일 수 있어요. 3개 이상 넣으면 무작위로 골라 보내요. 링크는 넣을 수 없어요.
              </p>
              {draft.replyTexts.map((t, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={t}
                    maxLength={REPLY_MAX}
                    onChange={(e) => set("replyTexts", draft.replyTexts.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label="문구 삭제"
                    onClick={() => set("replyTexts", draft.replyTexts.filter((_, j) => j !== i))}
                  >
                    ×
                  </Button>
                </div>
              ))}
              {draft.replyTexts.length < 5 && (
                <Button type="button" variant="outline" size="sm" onClick={() => set("replyTexts", [...draft.replyTexts, "{username} "])}>
                  문구 추가
                </Button>
              )}
              {draft.replyTexts.filter((t) => t.trim()).length < 3 && (
                <p className="text-xs text-amber-600">문구를 3개 이상 넣는 걸 권장해요.</p>
              )}
              <p className="text-xs text-muted-foreground">{"{username}"}은 댓글 단 사람의 @아이디로 바뀌어요.</p>
            </>
          )}
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dm">DM 내용</Label>
            <Textarea
              id="dm"
              rows={5}
              maxLength={DM_TEXT_MAX}
              value={draft.dmText}
              placeholder="요청하신 공구 링크 보내드려요! 오늘 자정까지 특가예요 🙌"
              onChange={(e) => set("dmText", e.target.value)}
            />
            <p className="text-right text-xs text-muted-foreground">
              {draft.dmText.length} / {DM_TEXT_MAX}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="btn">버튼 문구</Label>
            <Input id="btn" maxLength={BUTTON_TITLE_MAX} value={draft.dmButtonTitle} onChange={(e) => set("dmButtonTitle", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="url">링크</Label>
            <Input id="url" type="url" inputMode="url" value={draft.dmLinkUrl} onChange={(e) => set("dmLinkUrl", e.target.value)} />
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">자동화 이름</Label>
            <Input id="name" maxLength={50} value={draft.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <MessagePreview
            keyword={draft.keywords[0] ?? ""}
            reply={draft.replyEnabled ? (draft.replyTexts.find((t) => t.trim()) ?? null) : null}
            dmText={draft.dmText}
            buttonTitle={draft.dmButtonTitle}
            branding={branding}
          />
          <p className="text-xs text-muted-foreground">
            DM은 댓글을 단 사람에게 댓글당 1번, 댓글 후 7일 안에만 보낼 수 있어요. 같은 사람에게는 한 번만 보내요.
          </p>
        </section>
      )}

      <div className="flex gap-2">
        {step > 0 && (
          <Button type="button" variant="outline" className="flex-1" onClick={() => setStep((s) => s - 1)} disabled={pending}>
            이전
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button type="button" className="flex-1" onClick={next}>
            다음
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" className="flex-1" onClick={() => save(false)} disabled={pending}>
              저장만
            </Button>
            <Button type="button" className="flex-1" onClick={() => save(true)} disabled={pending}>
              켜고 저장
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 10: 삭제 버튼 (`src/components/app/delete-automation-button.tsx`)**

```tsx
"use client";

import { useState, useTransition } from "react";
import { deleteAutomationAction } from "@/app/app/automations/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function DeleteAutomationButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button variant="ghost" className="text-destructive" onClick={() => setOpen(true)}>
        삭제
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>자동화를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>발송 기록 통계도 함께 사라져요. 이미 보낸 DM의 링크는 계속 동작해요.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={() => startTransition(() => deleteAutomationAction(id))}>
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 11: 페이지 3개**

`src/app/app/automations/new/page.tsx`:
```tsx
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AutomationWizard } from "@/components/app/automation-wizard";
import { brandingLine } from "@/server/automations/render";
import { getUserPlan } from "@/server/billing/plan-of";
import { getDb } from "@/server/db/client";
import { igAccounts } from "@/server/db/schema";
import { requireUser } from "@/server/session";

export const metadata = { title: "새 자동화" };

export default async function NewAutomationPage() {
  const user = await requireUser();
  const db = getDb();
  const accounts = await db
    .select({ id: igAccounts.id, username: igAccounts.username })
    .from(igAccounts)
    .where(and(eq(igAccounts.userId, user.id), eq(igAccounts.status, "active")));
  if (accounts.length === 0) redirect("/app/onboarding");
  const plan = await getUserPlan(db, user.id);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">새 자동화</h1>
      <AutomationWizard accounts={accounts} branding={plan.branding ? brandingLine() : null} />
    </div>
  );
}
```
`src/app/app/automations/[id]/edit/page.tsx`:
```tsx
import { and, eq, ne } from "drizzle-orm";
import { notFound } from "next/navigation";
import { AutomationWizard } from "@/components/app/automation-wizard";
import { brandingLine } from "@/server/automations/render";
import { getAutomation } from "@/server/automations/service";
import { getUserPlan } from "@/server/billing/plan-of";
import { getDb } from "@/server/db/client";
import { igAccounts } from "@/server/db/schema";
import { requireUser } from "@/server/session";

export const metadata = { title: "자동화 수정" };

export default async function EditAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = getDb();
  const auto = /^[0-9a-f-]{36}$/i.test(id) ? await getAutomation(db, user.id, id) : null;
  if (!auto) notFound();
  const accounts = await db
    .select({ id: igAccounts.id, username: igAccounts.username })
    .from(igAccounts)
    .where(and(eq(igAccounts.userId, user.id), ne(igAccounts.status, "disconnected")));
  const plan = await getUserPlan(db, user.id);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">자동화 수정</h1>
      <AutomationWizard
        automationId={auto.id}
        accounts={accounts}
        branding={plan.branding ? brandingLine() : null}
        initial={{
          igAccountId: auto.igAccountId,
          name: auto.name,
          mediaScope: auto.mediaScope,
          media: auto.mediaId
            ? { id: auto.mediaId, thumbnailUrl: auto.mediaThumbnailUrl, permalink: auto.mediaPermalink, caption: auto.mediaCaption }
            : null,
          keywords: auto.keywords,
          matchType: auto.matchType,
          replyEnabled: auto.replyEnabled,
          replyTexts: auto.replyTexts,
          dmText: auto.dmText,
          dmButtonTitle: auto.dmButtonTitle,
          dmLinkUrl: auto.dmLinkUrl,
        }}
      />
    </div>
  );
}
```
`src/app/app/automations/[id]/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutomationToggle } from "@/components/app/automation-toggle";
import { DeleteAutomationButton } from "@/components/app/delete-automation-button";
import { EventList } from "@/components/app/event-list";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAutomation } from "@/server/automations/service";
import { getUserPlan } from "@/server/billing/plan-of";
import { getAutomationEvents, getAutomationStats } from "@/server/dashboard";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";

const SCOPE: Record<string, string> = { specific: "특정 게시물", all: "모든 게시물", next: "다음 게시물 (대기 중)" };

export default async function AutomationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = getDb();
  const auto = /^[0-9a-f-]{36}$/i.test(id) ? await getAutomation(db, user.id, id) : null;
  if (!auto) notFound();
  const [stats, events, plan] = await Promise.all([
    getAutomationStats(db, auto.id),
    getAutomationEvents(db, user.id, auto.id),
    getUserPlan(db, user.id),
  ]);
  const ctr = stats.linksSent > 0 ? Math.round((stats.linksClicked / stats.linksSent) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="truncate text-xl font-bold">{auto.name}</h1>
        <AutomationToggle id={auto.id} active={auto.isActive} label={auto.name} />
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center text-xs">
        {[
          ["트리거", stats.total],
          ["성공", stats.succeeded + stats.partial],
          ["실패", stats.failed],
          ["대기", stats.pending],
          ["클릭", plan.linkTracking ? stats.clicks : "Pro"],
          ["클릭률", plan.linkTracking ? `${ctr}%` : "Pro"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-md border bg-background py-3">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-base font-semibold">{typeof v === "number" ? v.toLocaleString() : v}</dd>
          </div>
        ))}
      </dl>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">설정</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">대상 · </span>
            {auto.mediaScope === "specific" && auto.mediaPermalink ? (
              <a href={auto.mediaPermalink} target="_blank" rel="noreferrer" className="underline">
                {SCOPE.specific}
              </a>
            ) : (
              SCOPE[auto.mediaScope]
            )}
          </p>
          <p>
            <span className="text-muted-foreground">키워드 · </span>
            {auto.keywords.join(", ")} ({auto.matchType === "exact" ? "정확히 일치" : "포함"})
          </p>
          <p>
            <span className="text-muted-foreground">공개 답글 · </span>
            {auto.replyEnabled ? `${auto.replyTexts.length}개 문구 랜덤` : "보내지 않음"}
          </p>
          <p className="whitespace-pre-wrap">
            <span className="text-muted-foreground">DM · </span>
            {auto.dmText}
          </p>
          <p className="truncate">
            <span className="text-muted-foreground">링크 · </span>
            {auto.dmButtonTitle} → {auto.dmLinkUrl}
          </p>
        </CardContent>
      </Card>
      <div className="flex gap-2">
        <Link href={`/app/automations/${auto.id}/edit`} className={buttonVariants({ variant: "outline", className: "flex-1" })}>
          수정
        </Link>
        <DeleteAutomationButton id={auto.id} />
      </div>
      <section className="space-y-3">
        <h2 className="font-semibold">발송 기록</h2>
        <EventList events={events} showAutomation={false} />
      </section>
    </div>
  );
}
```

- [ ] **Step 12: 빌드·수동 확인**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: 오류 없음

Run: `pnpm dev`, 로그인 후 dev DB에 테스트 계정을 넣어 위자드 흐름을 확인한다.
```bash
psql postgres://postgres:postgres@localhost:54329/igc_dev -c "insert into ig_accounts (user_id, ig_user_id, username, account_type, access_token_enc, token_expires_at) select id, '17841400000000001', 'demo_creator', 'BUSINESS', null, now() + interval '50 days' from \"user\" limit 1;"
```
Browser pane(모바일 375px)에서 `/app/automations/new` → "모든 게시물" 선택 → 키워드 "공구" → 답글 3개 → DM·링크 입력 → "켜고 저장" → 상세 페이지 이동, 토글 켜짐 표시.
Expected: 각 단계 검증 토스트, 저장 후 상세 페이지. 토큰이 없어 "특정 게시물" 목록은 오류 메시지가 뜨는 것이 정상.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat: add automation create/edit wizard with preview and detail page"
```

---
### Task 17: 결제 도메인 (포트원 게이트웨이, 구독·갱신·해지)

**Files:**
- Create: `src/server/billing/periods.ts`, `src/server/billing/gateway.ts`, `src/server/billing/subscriptions.ts`, `src/server/billing/deps.ts`, `tests/helpers/fake-billing.ts`
- Test: `tests/unit/periods.test.ts`, `tests/integration/billing.test.ts`

**Interfaces:**
- Consumes: `PLANS`, `isUpgrade`, `PaidPlanId`, `site`, `encryptSecret`/`decryptSecret`, `notifyUser`, `emails`, 스키마(`subscriptions`, `payments`, `automations`, `igAccounts`)
- Produces:
  - 기간 계산: `addMonthsKst(anchor: Date, months: number): Date`, `nextPeriodEnd(anchor: Date, after: Date): Date`, `kstDateStamp(d: Date): string`
  - 게이트웨이 타입: `interface BillingGateway { getBillingKey; charge; getPayment; deleteBillingKey }`, `BillingKeyInfo`, `ChargeInput`, `ChargeResult`, `RemotePayment`
  - 게이트웨이 팩토리: `createPortOneGateway(secret)`, `getBillingGateway()`, `setBillingGatewayForTesting(g)`, `billingConfigured(): boolean`
  - 의존성: `interface BillingDeps { db; gateway; now(); encrypt(); decrypt(); notify? }`, `createBillingDeps(db: Db): BillingDeps`
  - 구독 시작과 조회:
    - `ensureSubscription(db, userId): Promise<Subscription>`
    - `subscribe(deps, { userId, email, plan, billingKey, customerName?, customerPhone? }): Promise<{ ok: true; charged: boolean } | { ok: false; error: string }>`
  - 해지와 플랜 변경:
    - `setCancelAtPeriodEnd(db, userId, cancel: boolean): Promise<boolean>`
    - `scheduleDowngrade(db, userId, plan: "pro" | null): Promise<boolean>`
  - 갱신과 동기화:
    - `renewalPaymentId(subId, periodEnd, attempt): string`
    - `processDueRenewals(deps): Promise<number>`
    - `syncPayment(deps, paymentId): Promise<void>`
    - `applyPlanLimits(db, userId, planId): Promise<void>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/unit/periods.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { addMonthsKst, kstDateStamp, nextPeriodEnd } from "@/server/billing/periods";

// 2026-01-31 01:00 KST = 2026-01-30T16:00:00Z
const anchor = new Date("2026-01-30T16:00:00Z");

describe("KST billing periods", () => {
  it("clamps to the last day of shorter months", () => {
    expect(addMonthsKst(anchor, 1).toISOString()).toBe("2026-02-27T16:00:00.000Z"); // 2/28 01:00 KST
    expect(addMonthsKst(anchor, 2).toISOString()).toBe("2026-03-30T16:00:00.000Z"); // 3/31 01:00 KST
  });
  it("does not drift after a short month", () => {
    const feb = nextPeriodEnd(anchor, anchor);
    expect(feb.toISOString()).toBe("2026-02-27T16:00:00.000Z");
    expect(nextPeriodEnd(anchor, feb).toISOString()).toBe("2026-03-30T16:00:00.000Z");
  });
  it("skips forward past a late renewal", () => {
    expect(nextPeriodEnd(anchor, new Date("2026-04-15T00:00:00Z")).toISOString()).toBe("2026-04-29T16:00:00.000Z");
  });
  it("stamps dates in KST", () => {
    expect(kstDateStamp(new Date("2026-09-30T15:30:00Z"))).toBe("20261001");
  });
});
```
`tests/helpers/fake-billing.ts`:
```ts
import type {
  BillingGateway,
  BillingKeyInfo,
  ChargeInput,
  ChargeResult,
  RemotePayment,
} from "@/server/billing/gateway";

export class FakeBillingGateway implements BillingGateway {
  keys = new Map<string, BillingKeyInfo>();
  payments = new Map<string, RemotePayment>();
  charges: ChargeInput[] = [];
  deleted: string[] = [];
  nextCharge: ((input: ChargeInput) => ChargeResult | Error) | null = null;

  issueKey(billingKey: string, customerId: string, extra: Partial<BillingKeyInfo> = {}) {
    this.keys.set(billingKey, {
      status: "ISSUED",
      customerId,
      customerName: "홍길동",
      customerPhone: "01012345678",
      cardLabel: "신한카드 **** 1234",
      ...extra,
    });
  }

  async getBillingKey(billingKey: string) {
    return this.keys.get(billingKey) ?? null;
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const existing = this.payments.get(input.paymentId);
    if (existing?.status === "PAID") return { status: "paid", paidAt: existing.paidAt ?? new Date() };
    this.charges.push(input);
    const r = this.nextCharge?.(input) ?? { status: "paid" as const, paidAt: new Date() };
    if (r instanceof Error) throw r;
    this.payments.set(input.paymentId, {
      status: r.status === "paid" ? "PAID" : "FAILED",
      amount: input.amount,
      paidAt: r.status === "paid" ? r.paidAt : null,
      failureReason: r.status === "failed" ? r.reason : null,
    });
    return r;
  }

  async getPayment(paymentId: string) {
    return this.payments.get(paymentId) ?? null;
  }

  async deleteBillingKey(billingKey: string) {
    this.deleted.push(billingKey);
    const info = this.keys.get(billingKey);
    if (info) this.keys.set(billingKey, { ...info, status: "DELETED" });
  }
}
```
`tests/integration/billing.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  processDueRenewals,
  renewalPaymentId,
  scheduleDowngrade,
  setCancelAtPeriodEnd,
  subscribe,
  syncPayment,
  type BillingDeps,
} from "@/server/billing/subscriptions";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { automations, payments, subscriptions } from "@/server/db/schema";
import { resetDb } from "../helpers/db";
import { createAutomation, createIgAccount, createUser, setPlan } from "../helpers/factories";
import { FakeBillingGateway } from "../helpers/fake-billing";

let gateway: FakeBillingGateway;
let notices: string[];
let clock: Date;

function deps(): BillingDeps {
  return {
    db: getDb(),
    gateway,
    now: () => clock,
    encrypt: encryptSecret,
    decrypt: decryptSecret,
    notify: {
      paymentFailed: async (userId, plan) => void notices.push(`failed:${userId}:${plan}`),
      downgraded: async (userId, reason) => void notices.push(`downgraded:${userId}:${reason}`),
    },
  };
}

async function sub(userId: string) {
  const [row] = await getDb().select().from(subscriptions).where(eq(subscriptions.userId, userId));
  return row;
}

describe("billing", () => {
  beforeEach(async () => {
    await resetDb();
    gateway = new FakeBillingGateway();
    notices = [];
    clock = new Date("2026-01-30T16:00:00Z"); // 2026-01-31 01:00 KST
  });

  it("subscribes to pro: charges once and activates a monthly period", async () => {
    const u = await createUser();
    gateway.issueKey("bk_1", u.id);
    expect(await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" })).toEqual({ ok: true, charged: true });
    expect(gateway.charges).toHaveLength(1);
    expect(gateway.charges[0]).toMatchObject({ amount: 9900, orderName: "리치업 Pro 월 구독", customer: { id: u.id, name: "홍길동", phone: "01012345678" } });
    const s = await sub(u.id);
    expect(s).toMatchObject({ plan: "pro", status: "active", cardLabel: "신한카드 **** 1234", retryCount: 0 });
    expect(decryptSecret(s.billingKeyEnc ?? "")).toBe("bk_1");
    expect(s.currentPeriodEnd?.toISOString()).toBe("2026-02-27T16:00:00.000Z");
    const [p] = await getDb().select().from(payments);
    expect(p).toMatchObject({ status: "paid", plan: "pro", amount: 9900 });
  });

  it("rejects billing keys issued to someone else", async () => {
    const u = await createUser();
    gateway.issueKey("bk_x", "other-user");
    const res = await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_x" });
    expect(res.ok).toBe(false);
    expect(gateway.charges).toHaveLength(0);
  });

  it("keeps the user on free and deletes the new key when the first charge fails", async () => {
    const u = await createUser();
    gateway.issueKey("bk_1", u.id);
    gateway.nextCharge = () => ({ status: "failed", reason: "잔액 부족" });
    const res = await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" });
    expect(res).toEqual({ ok: false, error: "결제에 실패했어요: 잔액 부족" });
    expect((await sub(u.id)).plan).toBe("free");
    expect(gateway.deleted).toEqual(["bk_1"]);
    const [p] = await getDb().select().from(payments);
    expect(p.status).toBe("failed");
  });

  it("treats the same plan as a card change without charging", async () => {
    const u = await createUser();
    gateway.issueKey("bk_1", u.id);
    gateway.issueKey("bk_2", u.id, { cardLabel: "현대카드 **** 9999" });
    await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" });
    expect(await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_2" })).toEqual({ ok: true, charged: false });
    expect(gateway.charges).toHaveLength(1);
    expect(gateway.deleted).toEqual(["bk_1"]);
    expect((await sub(u.id)).cardLabel).toBe("현대카드 **** 9999");
  });

  it("upgrades pro to agency with an immediate charge and a new period", async () => {
    const u = await createUser();
    gateway.issueKey("bk_1", u.id);
    await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" });
    clock = new Date("2026-02-10T00:00:00Z");
    gateway.issueKey("bk_2", u.id);
    await subscribe(deps(), { userId: u.id, email: u.email, plan: "agency", billingKey: "bk_2" });
    expect(gateway.charges.map((c) => c.amount)).toEqual([9900, 59000]);
    const s = await sub(u.id);
    expect(s.plan).toBe("agency");
    expect(s.currentPeriodStart?.toISOString()).toBe("2026-02-10T00:00:00.000Z");
  });

  it("renews due subscriptions using the anchor day", async () => {
    const u = await createUser();
    gateway.issueKey("bk_1", u.id);
    await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" });
    const before = await sub(u.id);
    clock = new Date("2026-02-27T16:05:00Z");
    expect(await processDueRenewals(deps())).toBe(1);
    expect(gateway.charges[1].paymentId).toBe(renewalPaymentId(before.id, before.currentPeriodEnd!, 0));
    const s = await sub(u.id);
    expect(s.currentPeriodStart?.toISOString()).toBe("2026-02-27T16:00:00.000Z");
    expect(s.currentPeriodEnd?.toISOString()).toBe("2026-03-30T16:00:00.000Z");
    expect(await processDueRenewals(deps())).toBe(0);
  });

  it("retries failed renewals daily and downgrades after the third failure", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createAutomation(acct, { isActive: true });
    await createAutomation(acct, { isActive: true });
    gateway.issueKey("bk_1", u.id);
    await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" });
    gateway.nextCharge = () => ({ status: "failed", reason: "한도 초과" });

    clock = new Date("2026-02-27T16:05:00Z");
    await processDueRenewals(deps());
    let s = await sub(u.id);
    expect(s).toMatchObject({ status: "past_due", retryCount: 1, plan: "pro" });
    expect(s.nextRetryAt?.getTime()).toBe(clock.getTime() + 86_400_000);

    clock = new Date(clock.getTime() + 86_400_000 + 1000);
    await processDueRenewals(deps());
    clock = new Date(clock.getTime() + 86_400_000 + 1000);
    await processDueRenewals(deps());

    s = await sub(u.id);
    expect(s).toMatchObject({ plan: "free", status: "active", billingKeyEnc: null, currentPeriodEnd: null });
    expect(gateway.deleted).toContain("bk_1");
    const active = await getDb().select().from(automations).where(eq(automations.isActive, true));
    expect(active).toHaveLength(1);
    expect(notices.filter((n) => n.startsWith("failed"))).toHaveLength(2);
    expect(notices).toContain(`downgraded:${u.id}:payment_failed`);
  });

  it("downgrades at period end without charging when canceled", async () => {
    const u = await createUser();
    gateway.issueKey("bk_1", u.id);
    await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" });
    expect(await setCancelAtPeriodEnd(getDb(), u.id, true)).toBe(true);
    clock = new Date("2026-02-28T00:00:00Z");
    await processDueRenewals(deps());
    expect(gateway.charges).toHaveLength(1);
    expect((await sub(u.id)).plan).toBe("free");
    expect(notices).toContain(`downgraded:${u.id}:canceled`);
  });

  it("applies a scheduled downgrade at renewal with the lower price and limits", async () => {
    const u = await createUser();
    const a1 = await createIgAccount(u.id, { createdAt: new Date("2026-01-01T00:00:00Z") });
    const a2 = await createIgAccount(u.id, { createdAt: new Date("2026-01-02T00:00:00Z") });
    await createAutomation(a1, { isActive: true });
    await createAutomation(a2, { isActive: true });
    gateway.issueKey("bk_1", u.id);
    await subscribe(deps(), { userId: u.id, email: u.email, plan: "agency", billingKey: "bk_1" });
    expect(await scheduleDowngrade(getDb(), u.id, "pro")).toBe(true);
    clock = new Date("2026-02-28T00:00:00Z");
    await processDueRenewals(deps());
    expect(gateway.charges.map((c) => c.amount)).toEqual([59000, 9900]);
    expect(await sub(u.id)).toMatchObject({ plan: "pro", pendingPlan: null });
    const active = await getDb().select().from(automations).where(eq(automations.isActive, true));
    expect(active.map((a) => a.igAccountId)).toEqual([a1.id]);
  });

  it("never double-charges when the charge response is lost", async () => {
    const u = await createUser();
    gateway.issueKey("bk_1", u.id);
    await subscribe(deps(), { userId: u.id, email: u.email, plan: "pro", billingKey: "bk_1" });
    gateway.nextCharge = (input) => {
      gateway.payments.set(input.paymentId, { status: "PAID", amount: input.amount, paidAt: new Date(), failureReason: null });
      return new Error("socket hang up");
    };
    clock = new Date("2026-02-28T00:00:00Z");
    await processDueRenewals(deps());
    expect((await sub(u.id)).currentPeriodEnd?.toISOString()).toBe("2026-02-27T16:00:00.000Z");
    gateway.nextCharge = null;
    await processDueRenewals(deps());
    expect(gateway.charges).toHaveLength(2);
    expect((await sub(u.id)).currentPeriodEnd?.toISOString()).toBe("2026-03-30T16:00:00.000Z");
  });

  it("syncPayment activates a paid initial payment whose response was lost", async () => {
    const u = await createUser();
    const s = await setPlan(u.id, "free");
    await getDb().insert(payments).values({
      userId: u.id,
      subscriptionId: s.id,
      paymentId: "new_abc",
      plan: "pro",
      amount: 9900,
      periodStart: clock,
      periodEnd: new Date("2026-02-27T16:00:00Z"),
    });
    gateway.payments.set("new_abc", { status: "PAID", amount: 9900, paidAt: clock, failureReason: null });
    await syncPayment(deps(), "new_abc");
    expect(await sub(u.id)).toMatchObject({ plan: "pro", status: "active" });
    const [p] = await getDb().select().from(payments);
    expect(p.status).toBe("paid");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --project unit tests/unit/periods.test.ts; pnpm vitest run --project integration tests/integration/billing.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `src/server/billing/periods.ts`**

```ts
const KST_OFFSET_MS = 9 * 3_600_000;

export function addMonthsKst(anchor: Date, months: number): Date {
  const k = new Date(anchor.getTime() + KST_OFFSET_MS);
  const day = k.getUTCDate();
  const first = new Date(
    Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + months, 1, k.getUTCHours(), k.getUTCMinutes(), k.getUTCSeconds(), k.getUTCMilliseconds()),
  );
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return new Date(first.getTime() - KST_OFFSET_MS);
}

/** anchor + n개월 중 `after`보다 뒤인 첫 시각 (n ≥ 1) */
export function nextPeriodEnd(anchor: Date, after: Date): Date {
  const ka = new Date(anchor.getTime() + KST_OFFSET_MS);
  const kb = new Date(after.getTime() + KST_OFFSET_MS);
  let n = Math.max(1, (kb.getUTCFullYear() - ka.getUTCFullYear()) * 12 + (kb.getUTCMonth() - ka.getUTCMonth()));
  let end = addMonthsKst(anchor, n);
  while (end.getTime() <= after.getTime()) end = addMonthsKst(anchor, ++n);
  return end;
}

export function kstDateStamp(d: Date): string {
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, "0")}${String(k.getUTCDate()).padStart(2, "0")}`;
}
```

- [ ] **Step 4: `src/server/billing/gateway.ts`**

```ts
import { PortOneClient } from "@portone/server-sdk";
import { getEnv } from "@/server/env";

export interface BillingKeyInfo {
  status: "ISSUED" | "DELETED";
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  cardLabel: string | null;
}

export interface ChargeInput {
  paymentId: string;
  billingKey: string;
  orderName: string;
  amount: number;
  customer: { id: string; name: string | null; email: string | null; phone: string | null };
}

export type ChargeResult = { status: "paid"; paidAt: Date } | { status: "failed"; reason: string };

export interface RemotePayment {
  status: string;
  amount: number;
  paidAt: Date | null;
  failureReason: string | null;
}

export interface BillingGateway {
  getBillingKey(billingKey: string): Promise<BillingKeyInfo | null>;
  /** 결과를 알 수 없는 오류(네트워크·인증 설정)는 throw 한다. */
  charge(input: ChargeInput): Promise<ChargeResult>;
  getPayment(paymentId: string): Promise<RemotePayment | null>;
  deleteBillingKey(billingKey: string): Promise<void>;
}

interface SdkErrorShape {
  data?: { type?: string; message?: string; pgMessage?: string };
  message?: string;
}

const errType = (e: unknown) => (e as SdkErrorShape | undefined)?.data?.type;
const CONFIG_ERRORS = new Set(["UNAUTHORIZED", "FORBIDDEN", "INVALID_REQUEST", "CHANNEL_NOT_FOUND"]);

export function createPortOneGateway(secret: string): BillingGateway {
  const client = PortOneClient({ secret });

  const gateway: BillingGateway = {
    async getBillingKey(billingKey) {
      try {
        const info = (await client.payment.billingKey.getBillingKeyInfo({ billingKey })) as unknown as {
          status: string;
          customer?: { id?: string; name?: { full?: string }; phoneNumber?: string };
          methods?: { card?: { name?: string; issuer?: string; number?: string } }[];
        };
        const card = info.methods?.[0]?.card;
        const label = card ? [card.name ?? card.issuer, card.number ? `**** ${card.number.slice(-4)}` : null].filter(Boolean).join(" ") : "";
        return {
          status: info.status === "DELETED" ? "DELETED" : "ISSUED",
          customerId: info.customer?.id ?? null,
          customerName: info.customer?.name?.full ?? null,
          customerPhone: info.customer?.phoneNumber ?? null,
          cardLabel: label || null,
        };
      } catch (e) {
        if (errType(e) === "BILLING_KEY_NOT_FOUND") return null;
        throw e;
      }
    },

    async charge(input) {
      try {
        const res = (await client.payment.payWithBillingKey({
          paymentId: input.paymentId,
          billingKey: input.billingKey,
          orderName: input.orderName,
          customer: {
            id: input.customer.id,
            ...(input.customer.name ? { name: { full: input.customer.name } } : {}),
            ...(input.customer.email ? { email: input.customer.email } : {}),
            ...(input.customer.phone ? { phoneNumber: input.customer.phone } : {}),
          },
          amount: { total: input.amount },
          currency: "KRW",
        })) as unknown as { payment?: { paidAt?: string } };
        return { status: "paid", paidAt: res.payment?.paidAt ? new Date(res.payment.paidAt) : new Date() };
      } catch (e) {
        const type = errType(e);
        if (type === "ALREADY_PAID") {
          const p = await gateway.getPayment(input.paymentId);
          if (p?.status === "PAID") return { status: "paid", paidAt: p.paidAt ?? new Date() };
        }
        if (type && !CONFIG_ERRORS.has(type)) {
          const d = (e as SdkErrorShape).data;
          return { status: "failed", reason: d?.pgMessage ?? d?.message ?? type };
        }
        throw e;
      }
    },

    async getPayment(paymentId) {
      try {
        const p = (await client.payment.getPayment({ paymentId })) as unknown as {
          status: string;
          amount?: { total?: number };
          paidAt?: string;
          failure?: { reason?: string; pgMessage?: string };
        };
        return {
          status: p.status,
          amount: p.amount?.total ?? 0,
          paidAt: p.paidAt ? new Date(p.paidAt) : null,
          failureReason: p.failure?.pgMessage ?? p.failure?.reason ?? null,
        };
      } catch (e) {
        if (errType(e) === "PAYMENT_NOT_FOUND") return null;
        throw e;
      }
    },

    async deleteBillingKey(billingKey) {
      try {
        await client.payment.billingKey.deleteBillingKey({ billingKey });
      } catch (e) {
        const t = errType(e);
        if (t === "BILLING_KEY_NOT_FOUND" || t === "BILLING_KEY_ALREADY_DELETED") return;
        throw e;
      }
    },
  };
  return gateway;
}

let override: BillingGateway | null = null;
let instance: BillingGateway | null = null;

export function billingConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.PORTONE_API_SECRET && env.PORTONE_STORE_ID && env.PORTONE_CHANNEL_KEY);
}

export function getBillingGateway(): BillingGateway {
  if (override) return override;
  const secret = getEnv().PORTONE_API_SECRET;
  if (!secret) throw new Error("PORTONE_API_SECRET is not configured");
  instance ??= createPortOneGateway(secret);
  return instance;
}

export function setBillingGatewayForTesting(g: BillingGateway | null): void {
  override = g;
}
```
SDK 메서드 이름·경로(`payment.billingKey.getBillingKeyInfo` 등)가 설치된 버전과 다르면 `node_modules/@portone/server-sdk/dist/generated/payment/**/client.d.ts`에서 실제 이름을 확인해 맞춘다. 인터페이스(`BillingGateway`)는 바꾸지 않는다.

- [ ] **Step 5: `src/server/billing/subscriptions.ts`**

```ts
import { and, asc, desc, eq, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { isUpgrade, PLANS, type PaidPlanId, type PlanId } from "@/lib/plans";
import { site } from "@/lib/site";
import type { Db } from "@/server/db/client";
import { automations, igAccounts, payments, subscriptions, type Subscription } from "@/server/db/schema";
import { errorFields, log } from "@/server/log";
import type { BillingGateway } from "./gateway";
import { kstDateStamp, nextPeriodEnd } from "./periods";

export interface BillingDeps {
  db: Db;
  gateway: BillingGateway;
  now: () => Date;
  encrypt: (s: string) => string;
  decrypt: (s: string) => string;
  notify?: {
    paymentFailed(userId: string, planName: string, nextRetryAt: Date | null): Promise<void>;
    downgraded(userId: string, reason: "payment_failed" | "canceled"): Promise<void>;
  };
}

export type SubscribeResult = { ok: true; charged: boolean } | { ok: false; error: string };

const MAX_RENEWAL_ATTEMPTS = 3;
const RETRY_DELAY_MS = 86_400_000;
const LEASE_MS = 120_000;

const shortId = (id: string) => id.replace(/-/g, "").slice(0, 12);
const orderName = (plan: PlanId) => `${site.name} ${PLANS[plan].name} 월 구독`;

export function renewalPaymentId(subId: string, periodEnd: Date, attempt: number): string {
  return `sub_${shortId(subId)}_${kstDateStamp(periodEnd)}_${attempt}`;
}

export async function ensureSubscription(db: Db, userId: string): Promise<Subscription> {
  await db.insert(subscriptions).values({ userId }).onConflictDoNothing({ target: subscriptions.userId });
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  return row;
}

async function withLease<T>(db: Db, subId: string, now: Date, fn: () => Promise<T>): Promise<T | "locked"> {
  const got = await db
    .update(subscriptions)
    .set({ billingLockedUntil: new Date(now.getTime() + LEASE_MS) })
    .where(
      and(
        eq(subscriptions.id, subId),
        or(isNull(subscriptions.billingLockedUntil), lt(subscriptions.billingLockedUntil, now)),
      ),
    )
    .returning({ id: subscriptions.id });
  if (got.length === 0) return "locked";
  try {
    return await fn();
  } finally {
    await db.update(subscriptions).set({ billingLockedUntil: null }).where(eq(subscriptions.id, subId));
  }
}

async function safeDeleteKey(gateway: BillingGateway, billingKey: string): Promise<void> {
  try {
    await gateway.deleteBillingKey(billingKey);
  } catch (e) {
    log.error("billing key deletion failed", errorFields(e));
  }
}

export async function subscribe(
  deps: BillingDeps,
  p: {
    userId: string;
    email: string;
    plan: PaidPlanId;
    billingKey: string;
    customerName?: string | null;
    customerPhone?: string | null;
  },
): Promise<SubscribeResult> {
  const { db, gateway } = deps;
  const info = await gateway.getBillingKey(p.billingKey);
  if (!info || info.status !== "ISSUED" || info.customerId !== p.userId) {
    return { ok: false, error: "카드 정보를 확인할 수 없어요. 다시 등록해주세요" };
  }
  const base = await ensureSubscription(db, p.userId);
  const now = deps.now();

  const result = await withLease(db, base.id, now, async (): Promise<SubscribeResult> => {
    const [current] = await db.select().from(subscriptions).where(eq(subscriptions.id, base.id));
    const paidActive = current.plan !== "free" && current.status !== "canceled";
    const name = p.customerName ?? info.customerName ?? current.customerName;
    const phone = p.customerPhone ?? info.customerPhone ?? current.customerPhone;
    const oldKey = current.billingKeyEnc ? deps.decrypt(current.billingKeyEnc) : null;

    if (paidActive && current.plan === p.plan) {
      await db
        .update(subscriptions)
        .set({ billingKeyEnc: deps.encrypt(p.billingKey), cardLabel: info.cardLabel, customerName: name, customerPhone: phone })
        .where(eq(subscriptions.id, current.id));
      if (oldKey && oldKey !== p.billingKey) await safeDeleteKey(gateway, oldKey);
      return { ok: true, charged: false };
    }
    if (paidActive && !isUpgrade(current.plan, p.plan)) {
      await safeDeleteKey(gateway, p.billingKey);
      return { ok: false, error: "하위 플랜으로는 '다음 결제일부터 변경'을 이용해주세요" };
    }

    const periodEnd = nextPeriodEnd(now, now);
    const paymentId = `new_${shortId(current.id)}_${now.getTime().toString(36)}`;
    const amount = PLANS[p.plan].priceKrw;
    await db.insert(payments).values({
      userId: p.userId,
      subscriptionId: current.id,
      paymentId,
      plan: p.plan,
      amount,
      periodStart: now,
      periodEnd,
    });
    const charge = await gateway.charge({
      paymentId,
      billingKey: p.billingKey,
      orderName: orderName(p.plan),
      amount,
      customer: { id: p.userId, name, email: p.email, phone },
    });
    if (charge.status === "failed") {
      await db.update(payments).set({ status: "failed", failureReason: charge.reason }).where(eq(payments.paymentId, paymentId));
      await safeDeleteKey(gateway, p.billingKey);
      return { ok: false, error: `결제에 실패했어요: ${charge.reason}` };
    }
    await db.update(payments).set({ status: "paid", paidAt: charge.paidAt }).where(eq(payments.paymentId, paymentId));
    await db
      .update(subscriptions)
      .set({
        plan: p.plan,
        status: "active",
        billingKeyEnc: deps.encrypt(p.billingKey),
        cardLabel: info.cardLabel,
        customerName: name,
        customerPhone: phone,
        billingAnchorAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        pendingPlan: null,
        retryCount: 0,
        nextRetryAt: null,
      })
      .where(eq(subscriptions.id, current.id));
    if (oldKey && oldKey !== p.billingKey) await safeDeleteKey(gateway, oldKey);
    return { ok: true, charged: true };
  });

  return result === "locked" ? { ok: false, error: "결제가 진행 중이에요. 잠시 후 다시 시도해주세요" } : result;
}

export async function setCancelAtPeriodEnd(db: Db, userId: string, cancel: boolean): Promise<boolean> {
  const rows = await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: cancel })
    .where(and(eq(subscriptions.userId, userId), ne(subscriptions.plan, "free")))
    .returning({ id: subscriptions.id });
  return rows.length > 0;
}

export async function scheduleDowngrade(db: Db, userId: string, plan: "pro" | null): Promise<boolean> {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  if (!sub || sub.plan === "free") return false;
  if (plan && !isUpgrade(plan, sub.plan)) return false;
  await db.update(subscriptions).set({ pendingPlan: plan }).where(eq(subscriptions.id, sub.id));
  return true;
}

export async function applyPlanLimits(db: Db, userId: string, planId: PlanId): Promise<void> {
  const plan = PLANS[planId];
  const accounts = await db
    .select({ id: igAccounts.id })
    .from(igAccounts)
    .where(and(eq(igAccounts.userId, userId), ne(igAccounts.status, "disconnected")))
    .orderBy(asc(igAccounts.createdAt));
  const overflow = accounts.slice(plan.maxIgAccounts).map((a) => a.id);
  if (overflow.length > 0) {
    await db.update(automations).set({ isActive: false }).where(inArray(automations.igAccountId, overflow));
  }
  if (plan.maxActiveAutomations !== null) {
    const active = await db
      .select({ id: automations.id })
      .from(automations)
      .where(and(eq(automations.userId, userId), eq(automations.isActive, true)))
      .orderBy(desc(automations.updatedAt));
    const extra = active.slice(plan.maxActiveAutomations).map((a) => a.id);
    if (extra.length > 0) await db.update(automations).set({ isActive: false }).where(inArray(automations.id, extra));
  }
}

async function downgradeToFree(deps: BillingDeps, sub: Subscription, reason: "payment_failed" | "canceled"): Promise<void> {
  if (sub.billingKeyEnc) await safeDeleteKey(deps.gateway, deps.decrypt(sub.billingKeyEnc));
  await deps.db
    .update(subscriptions)
    .set({
      plan: "free",
      status: "active",
      billingKeyEnc: null,
      cardLabel: null,
      billingAnchorAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      pendingPlan: null,
      retryCount: 0,
      nextRetryAt: null,
    })
    .where(eq(subscriptions.id, sub.id));
  await applyPlanLimits(deps.db, sub.userId, "free");
  await deps.notify?.downgraded(sub.userId, reason);
}

async function renewOne(deps: BillingDeps, subId: string): Promise<void> {
  const { db } = deps;
  const now = deps.now();
  await withLease(db, subId, now, async () => {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, subId));
    if (!sub || sub.plan === "free" || !sub.currentPeriodEnd) return;
    const due =
      (sub.status === "active" && sub.currentPeriodEnd <= now) ||
      (sub.status === "past_due" && sub.nextRetryAt !== null && sub.nextRetryAt <= now);
    if (!due) return;
    if (sub.cancelAtPeriodEnd || !sub.billingKeyEnc) {
      await downgradeToFree(deps, sub, "canceled");
      return;
    }

    const plan = sub.pendingPlan ?? sub.plan;
    const periodStart = sub.currentPeriodEnd;
    const periodEnd = nextPeriodEnd(sub.billingAnchorAt ?? periodStart, periodStart);
    const paymentId = renewalPaymentId(sub.id, periodStart, sub.retryCount);
    await db
      .insert(payments)
      .values({ userId: sub.userId, subscriptionId: sub.id, paymentId, plan, amount: PLANS[plan].priceKrw, periodStart, periodEnd })
      .onConflictDoNothing({ target: payments.paymentId });

    let result;
    try {
      result = await deps.gateway.charge({
        paymentId,
        billingKey: deps.decrypt(sub.billingKeyEnc),
        orderName: orderName(plan),
        amount: PLANS[plan].priceKrw,
        customer: { id: sub.userId, name: sub.customerName, email: null, phone: sub.customerPhone },
      });
    } catch (e) {
      log.error("renewal charge outcome unknown; will retry with the same paymentId", { subscriptionId: sub.id, ...errorFields(e) });
      return;
    }

    if (result.status === "paid") {
      await db.update(payments).set({ status: "paid", paidAt: result.paidAt }).where(eq(payments.paymentId, paymentId));
      await db
        .update(subscriptions)
        .set({ plan, pendingPlan: null, status: "active", currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, retryCount: 0, nextRetryAt: null })
        .where(eq(subscriptions.id, sub.id));
      if (plan !== sub.plan) await applyPlanLimits(db, sub.userId, plan);
      return;
    }

    await db.update(payments).set({ status: "failed", failureReason: result.reason }).where(eq(payments.paymentId, paymentId));
    const attempts = sub.retryCount + 1;
    if (attempts >= MAX_RENEWAL_ATTEMPTS) {
      await downgradeToFree(deps, sub, "payment_failed");
      return;
    }
    const nextRetryAt = new Date(now.getTime() + RETRY_DELAY_MS);
    await db
      .update(subscriptions)
      .set({ status: "past_due", retryCount: attempts, nextRetryAt })
      .where(eq(subscriptions.id, sub.id));
    await deps.notify?.paymentFailed(sub.userId, PLANS[plan].name, nextRetryAt);
  });
}

export async function processDueRenewals(deps: BillingDeps): Promise<number> {
  const now = deps.now();
  const due = await deps.db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        ne(subscriptions.plan, "free"),
        or(
          and(eq(subscriptions.status, "active"), lte(subscriptions.currentPeriodEnd, now)),
          and(eq(subscriptions.status, "past_due"), lte(subscriptions.nextRetryAt, now)),
        ),
      ),
    )
    .limit(100);
  for (const { id } of due) {
    try {
      await renewOne(deps, id);
    } catch (e) {
      log.error("renewal failed", { subscriptionId: id, ...errorFields(e) });
    }
  }
  return due.length;
}

export async function syncPayment(deps: BillingDeps, paymentId: string): Promise<void> {
  const { db } = deps;
  const [row] = await db.select().from(payments).where(eq(payments.paymentId, paymentId));
  if (!row) return;
  const remote = await deps.gateway.getPayment(paymentId);
  if (!remote) return;

  if (remote.status === "PAID" && row.status !== "paid") {
    if (remote.amount !== row.amount) {
      log.error("payment amount mismatch", { paymentId });
      return;
    }
    await db.update(payments).set({ status: "paid", paidAt: remote.paidAt ?? deps.now() }).where(eq(payments.id, row.id));
    if (row.subscriptionId && row.periodEnd) {
      await db
        .update(subscriptions)
        .set({
          plan: row.plan,
          status: "active",
          currentPeriodStart: row.periodStart,
          currentPeriodEnd: row.periodEnd,
          billingAnchorAt: sql`coalesce(${subscriptions.billingAnchorAt}, ${row.periodStart})`,
          retryCount: 0,
          nextRetryAt: null,
        })
        .where(
          and(
            eq(subscriptions.id, row.subscriptionId),
            or(isNull(subscriptions.currentPeriodEnd), lt(subscriptions.currentPeriodEnd, row.periodEnd)),
          ),
        );
    }
  } else if (remote.status === "FAILED" && row.status === "pending") {
    await db.update(payments).set({ status: "failed", failureReason: remote.failureReason }).where(eq(payments.id, row.id));
  } else if ((remote.status === "CANCELLED" || remote.status === "PARTIAL_CANCELLED") && row.status !== "canceled") {
    await db.update(payments).set({ status: "canceled" }).where(eq(payments.id, row.id));
  }
}
```

- [ ] **Step 6: `src/server/billing/deps.ts`**

```ts
import { decryptSecret, encryptSecret } from "@/server/crypto";
import type { Db } from "@/server/db/client";
import { emails } from "@/server/emails";
import { notifyUser } from "@/server/notifications";
import { getBillingGateway } from "./gateway";
import type { BillingDeps } from "./subscriptions";

export function createBillingDeps(db: Db): BillingDeps {
  return {
    db,
    gateway: getBillingGateway(),
    now: () => new Date(),
    encrypt: encryptSecret,
    decrypt: decryptSecret,
    notify: {
      paymentFailed: (userId, planName, nextRetryAt) => notifyUser(db, userId, emails.paymentFailed(planName, nextRetryAt)),
      downgraded: (userId, reason) => notifyUser(db, userId, emails.downgraded(reason)),
    },
  };
}
```

- [ ] **Step 7: 통과 확인**

Run: `pnpm vitest run --project unit tests/unit/periods.test.ts && pnpm vitest run --project integration tests/integration/billing.test.ts && pnpm typecheck`
Expected: PASS, 타입 오류 없음

- [ ] **Step 8: Commit**

```bash
git add src/server/billing tests/helpers/fake-billing.ts tests/unit/periods.test.ts tests/integration/billing.test.ts
git commit -m "feat: add PortOne billing gateway and subscription lifecycle with renewals"
```

---

### Task 18: 결제 화면·API·포트원 웹훅·갱신 잡

**Files:**
- Create: `src/app/api/billing/subscribe/route.ts`, `src/app/api/webhooks/portone/route.ts`, `src/app/app/billing/actions.ts`
- Create: `src/app/app/billing/page.tsx`, `src/app/app/billing/complete/page.tsx`, `src/components/app/billing-client.tsx`
- Modify: `src/worker/index.ts` (갱신 잡 추가)
- Test: `tests/integration/portone-webhook.test.ts`

**Interfaces:**
- Consumes: `subscribe`, `syncPayment`, `setCancelAtPeriodEnd`, `scheduleDowngrade`, `createBillingDeps`, `billingConfigured`, `setBillingGatewayForTesting`, `processDueRenewals`, `PLANS`, `formatKrw`
- Produces: `POST /api/billing/subscribe`, `POST /api/webhooks/portone`, 서버 액션 `cancelSubscriptionAction()`, `resumeSubscriptionAction()`, `scheduleDowngradeAction(plan: "pro" | null)`

- [ ] **Step 1: 실패하는 테스트 작성 (`tests/integration/portone-webhook.test.ts`)**

```ts
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/portone/route";
import { setBillingGatewayForTesting } from "@/server/billing/gateway";
import { getDb } from "@/server/db/client";
import { payments } from "@/server/db/schema";
import { resetDb } from "../helpers/db";
import { createUser, setPlan } from "../helpers/factories";
import { FakeBillingGateway } from "../helpers/fake-billing";

function signed(body: string, secretB64 = process.env.PORTONE_WEBHOOK_SECRET ?? "") {
  const id = "msg_test_1";
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = createHmac("sha256", Buffer.from(secretB64, "base64")).update(`${id}.${ts}.${body}`).digest("base64");
  return new Request("http://localhost:3000/api/webhooks/portone", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` },
  });
}

describe("portone webhook", () => {
  let gateway: FakeBillingGateway;
  beforeEach(async () => {
    await resetDb();
    gateway = new FakeBillingGateway();
    setBillingGatewayForTesting(gateway);
  });
  afterEach(() => setBillingGatewayForTesting(null));

  it("rejects bad signatures", async () => {
    const res = await POST(signed("{}", Buffer.from("wrong").toString("base64")));
    expect(res.status).toBe(400);
  });

  it("re-fetches the payment and marks it paid", async () => {
    const u = await createUser();
    const s = await setPlan(u.id, "free");
    await getDb().insert(payments).values({
      userId: u.id, subscriptionId: s.id, paymentId: "new_abc", plan: "pro", amount: 9900,
      periodStart: new Date(), periodEnd: new Date(Date.now() + 30 * 86_400_000),
    });
    gateway.payments.set("new_abc", { status: "PAID", amount: 9900, paidAt: new Date(), failureReason: null });
    const body = JSON.stringify({
      type: "Transaction.Paid",
      timestamp: new Date().toISOString(),
      data: { storeId: "store-test", paymentId: "new_abc", transactionId: "tx_1" },
    });
    const res = await POST(signed(body));
    expect(res.status).toBe(200);
    const [p] = await getDb().select().from(payments);
    expect(p.status).toBe("paid");
  });

  it("acknowledges unknown event types", async () => {
    const body = JSON.stringify({ type: "Something.New", timestamp: new Date().toISOString(), data: {} });
    expect((await POST(signed(body))).status).toBe(200);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --project integration tests/integration/portone-webhook.test.ts`
Expected: FAIL — 라우트 없음

- [ ] **Step 3: 포트원 웹훅 라우트 (`src/app/api/webhooks/portone/route.ts`)**

```ts
import { Webhook } from "@portone/server-sdk";
import { createBillingDeps } from "@/server/billing/deps";
import { syncPayment } from "@/server/billing/subscriptions";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { log } from "@/server/log";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = getEnv().PORTONE_WEBHOOK_SECRET;
  if (!secret) return new Response("not configured", { status: 503 });
  const body = await req.text();
  let hook: Awaited<ReturnType<typeof Webhook.verify>>;
  try {
    hook = await Webhook.verify(secret, body, Object.fromEntries(req.headers));
  } catch (e) {
    if (e instanceof Webhook.WebhookVerificationError) return new Response("invalid signature", { status: 400 });
    throw e;
  }
  if (!Webhook.isUnrecognizedWebhook(hook) && hook.type.startsWith("Transaction.")) {
    const paymentId = (hook.data as { paymentId?: string }).paymentId;
    if (paymentId) {
      await syncPayment(createBillingDeps(getDb()), paymentId);
      log.info("portone webhook synced", { type: hook.type });
    }
  }
  return new Response("ok", { status: 200 });
}
```
SDK가 알 수 없는 `type`을 검증 단계에서 거부하면(3번째 테스트 실패) `Webhook.verify` 대신 `JSON.parse(body)`로 `type`을 먼저 확인하고, `Transaction.`으로 시작할 때만 `verify`의 결과를 쓰도록 순서를 바꾼다. 서명 검증은 어떤 경우에도 생략하지 않는다.

- [ ] **Step 4: 구독 API (`src/app/api/billing/subscribe/route.ts`)**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createBillingDeps } from "@/server/billing/deps";
import { billingConfigured } from "@/server/billing/gateway";
import { subscribe } from "@/server/billing/subscriptions";
import { getDb } from "@/server/db/client";
import { errorFields, log } from "@/server/log";
import { getSessionUser } from "@/server/session";

const bodySchema = z.object({
  plan: z.enum(["pro", "agency"]),
  billingKey: z.string().min(1).max(300),
  customerName: z.string().trim().min(1).max(50).optional(),
  customerPhone: z.string().regex(/^0\d{8,10}$/).optional(),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "로그인이 필요해요" }, { status: 401 });
  if (!billingConfigured()) return NextResponse.json({ ok: false, error: "결제 설정이 아직 준비되지 않았어요" }, { status: 503 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "잘못된 요청이에요" }, { status: 400 });
  try {
    const res = await subscribe(createBillingDeps(getDb()), { userId: user.id, email: user.email, ...parsed.data });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (e) {
    log.error("subscribe failed", errorFields(e));
    return NextResponse.json(
      { ok: false, error: "결제 확인 중 오류가 발생했어요. 결제 내역을 확인한 뒤 다시 시도해주세요" },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 5: 결제 서버 액션 (`src/app/app/billing/actions.ts`)**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { scheduleDowngrade, setCancelAtPeriodEnd } from "@/server/billing/subscriptions";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";

export async function cancelSubscriptionAction(): Promise<boolean> {
  const user = await requireUser();
  const ok = await setCancelAtPeriodEnd(getDb(), user.id, true);
  revalidatePath("/app/billing");
  return ok;
}

export async function resumeSubscriptionAction(): Promise<boolean> {
  const user = await requireUser();
  const ok = await setCancelAtPeriodEnd(getDb(), user.id, false);
  revalidatePath("/app/billing");
  return ok;
}

export async function scheduleDowngradeAction(plan: "pro" | null): Promise<boolean> {
  const user = await requireUser();
  const ok = await scheduleDowngrade(getDb(), user.id, plan === "pro" ? "pro" : null);
  revalidatePath("/app/billing");
  return ok;
}
```

- [ ] **Step 6: 결제 클라이언트 (`src/components/app/billing-client.tsx`)**

```tsx
"use client";

import * as PortOne from "@portone/browser-sdk/v2";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { cancelSubscriptionAction, resumeSubscriptionAction, scheduleDowngradeAction } from "@/app/app/billing/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatKrw, isUpgrade, PLANS, type PaidPlanId, type PlanId } from "@/lib/plans";

export interface BillingClientProps {
  storeId: string;
  channelKey: string;
  appUrl: string;
  user: { id: string; email: string };
  current: {
    plan: PlanId;
    paidActive: boolean;
    cancelAtPeriodEnd: boolean;
    pendingPlan: PlanId | null;
    customerName: string | null;
    customerPhone: string | null;
  };
}

export function BillingClient({ storeId, channelKey, appUrl, user, current }: BillingClientProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<PaidPlanId | null>(null);
  const [name, setName] = useState(current.customerName ?? "");
  const [phone, setPhone] = useState(current.customerPhone ?? "");
  const [pending, startTransition] = useTransition();

  async function registerAndPay(plan: PaidPlanId) {
    const cleanPhone = phone.replace(/\D/g, "");
    if (!name.trim()) return toast.error("결제자 이름을 입력해주세요");
    if (!/^0\d{8,10}$/.test(cleanPhone)) return toast.error("휴대폰 번호를 확인해주세요");
    const res = await PortOne.requestIssueBillingKey({
      storeId,
      channelKey,
      billingKeyMethod: "CARD",
      issueId: `issue_${Date.now().toString(36)}`,
      issueName: `${PLANS[plan].name} 월 정기결제`,
      customer: { customerId: user.id, fullName: name.trim(), phoneNumber: cleanPhone, email: user.email },
      offerPeriod: { interval: "1m" },
      redirectUrl: `${appUrl}/app/billing/complete?plan=${plan}`,
    });
    if (!res || res.code !== undefined || !res.billingKey) {
      toast.error(res?.message ?? "카드 등록이 취소됐어요");
      return;
    }
    const apiRes = await fetch("/api/billing/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan, billingKey: res.billingKey, customerName: name.trim(), customerPhone: cleanPhone }),
    });
    const body = (await apiRes.json()) as { ok: boolean; charged?: boolean; error?: string };
    if (!body.ok) return toast.error(body.error ?? "결제에 실패했어요");
    toast.success(body.charged ? `${PLANS[plan].name} 플랜이 시작됐어요` : "카드를 변경했어요");
    setSelected(null);
    router.refresh();
  }

  const act = (fn: () => Promise<boolean>, success: string) =>
    startTransition(async () => {
      if (await fn()) toast.success(success);
      else toast.error("처리하지 못했어요");
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {(["pro", "agency"] as const).map((id) => {
        const plan = PLANS[id];
        const isCurrent = current.paidActive && current.plan === id;
        const upgrade = !current.paidActive || isUpgrade(current.plan, id);
        return (
          <Card key={id} className={isCurrent ? "border-foreground" : undefined}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                {plan.name}
                <span>{formatKrw(plan.priceKrw)} / 월</span>
              </CardTitle>
              <CardDescription>
                계정 {plan.maxIgAccounts}개 · 자동화 무제한 · 월 DM {plan.monthlyDmLimit.toLocaleString()}건 · 링크 클릭 추적
              </CardDescription>
            </CardHeader>
            {selected === id && (
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`name-${id}`}>결제자 이름</Label>
                  <Input id={`name-${id}`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`phone-${id}`}>휴대폰 번호</Label>
                  <Input id={`phone-${id}`} value={phone} inputMode="tel" placeholder="01012345678" onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
                </div>
                <p className="text-xs text-muted-foreground">
                  {isCurrent
                    ? "새 카드를 등록하면 다음 결제부터 새 카드로 청구돼요."
                    : `등록 즉시 ${formatKrw(plan.priceKrw)}이 결제되고, 매월 같은 날 자동 결제돼요. 언제든 해지할 수 있어요.`}
                </p>
              </CardContent>
            )}
            <CardFooter className="gap-2">
              {selected === id ? (
                <>
                  <Button variant="outline" onClick={() => setSelected(null)} disabled={pending}>
                    취소
                  </Button>
                  <Button className="flex-1" disabled={pending} onClick={() => startTransition(() => registerAndPay(id))}>
                    {isCurrent ? "카드 등록" : "카드 등록하고 결제"}
                  </Button>
                </>
              ) : isCurrent ? (
                <Button variant="outline" className="w-full" onClick={() => setSelected(id)}>
                  현재 플랜 · 카드 변경
                </Button>
              ) : upgrade ? (
                <Button className="w-full" onClick={() => setSelected(id)}>
                  {current.paidActive ? "업그레이드" : "시작하기"}
                </Button>
              ) : current.pendingPlan === id ? (
                <Button variant="outline" className="w-full" disabled={pending} onClick={() => act(() => scheduleDowngradeAction(null), "변경 예약을 취소했어요")}>
                  다음 결제일부터 변경 예정 · 취소
                </Button>
              ) : (
                <Button variant="outline" className="w-full" disabled={pending} onClick={() => act(() => scheduleDowngradeAction("pro"), "다음 결제일부터 Pro로 변경돼요")}>
                  다음 결제일부터 변경
                </Button>
              )}
            </CardFooter>
          </Card>
        );
      })}

      {current.paidActive && (
        <div className="text-center">
          {current.cancelAtPeriodEnd ? (
            <Button variant="link" disabled={pending} onClick={() => act(resumeSubscriptionAction, "해지를 취소했어요")}>
              해지 취소하고 계속 이용하기
            </Button>
          ) : (
            <Button variant="link" className="text-muted-foreground" disabled={pending} onClick={() => act(cancelSubscriptionAction, "현재 결제 기간이 끝나면 해지돼요")}>
              구독 해지
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
```
`requestIssueBillingKey`의 파라미터 타입이 문자열 리터럴을 거부하면(예: `billingKeyMethod`, `offerPeriod`) SDK 타입 정의(`node_modules/@portone/browser-sdk/dist/v2/**/*.d.ts`)의 enum/타입을 import해 같은 값으로 바꾼다.

- [ ] **Step 7: 결제 페이지와 모바일 복귀 페이지**

`src/app/app/billing/page.tsx`:
```tsx
import { desc, eq } from "drizzle-orm";
import { BillingClient } from "@/components/app/billing-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKrw, PLANS } from "@/lib/plans";
import { billingConfigured } from "@/server/billing/gateway";
import { getDb } from "@/server/db/client";
import { payments, subscriptions } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { requireUser } from "@/server/session";

export const metadata = { title: "결제" };

const kstDate = (d: Date) => d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
const PAYMENT_STATUS: Record<string, string> = { pending: "확인 중", paid: "결제 완료", failed: "실패", canceled: "취소" };

export default async function BillingPage() {
  const user = await requireUser();
  const db = getDb();
  const env = getEnv();
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id));
  const history = await db.select().from(payments).where(eq(payments.userId, user.id)).orderBy(desc(payments.createdAt)).limit(24);
  const plan = sub && sub.status !== "canceled" ? sub.plan : "free";
  const paidActive = plan !== "free";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">결제</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">현재 플랜: {PLANS[plan].name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          {paidActive && sub?.currentPeriodEnd && (
            <p>
              {sub.cancelAtPeriodEnd ? "이용 종료일" : "다음 결제일"}: {kstDate(sub.currentPeriodEnd)}
              {sub.pendingPlan && ` · 다음 결제부터 ${PLANS[sub.pendingPlan].name}`}
            </p>
          )}
          {sub?.cardLabel && <p>결제 카드: {sub.cardLabel}</p>}
          {sub?.status === "past_due" && (
            <p className="font-medium text-destructive">
              결제에 실패했어요. {sub.nextRetryAt ? `${kstDate(sub.nextRetryAt)}에 다시 시도해요.` : ""} 카드를 변경해주세요.
            </p>
          )}
          {!paidActive && <p>무료 플랜: 자동화 1개, 월 DM 300건</p>}
        </CardContent>
      </Card>

      {billingConfigured() && env.PORTONE_STORE_ID && env.PORTONE_CHANNEL_KEY ? (
        <BillingClient
          storeId={env.PORTONE_STORE_ID}
          channelKey={env.PORTONE_CHANNEL_KEY}
          appUrl={env.APP_URL}
          user={{ id: user.id, email: user.email }}
          current={{
            plan,
            paidActive,
            cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
            pendingPlan: sub?.pendingPlan ?? null,
            customerName: sub?.customerName ?? null,
            customerPhone: sub?.customerPhone ?? null,
          }}
        />
      ) : (
        <Alert>
          <AlertDescription>결제 기능 준비 중이에요. 곧 유료 플랜을 이용할 수 있어요.</AlertDescription>
        </Alert>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">결제 내역</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">결제 내역이 없어요</p>
        ) : (
          <ul className="divide-y rounded-lg border bg-background text-sm">
            {history.map((p) => (
              <li key={p.id} className="flex items-center justify-between p-3">
                <span>
                  {kstDate(p.createdAt)} · {PLANS[p.plan].name}
                </span>
                <span>
                  {formatKrw(p.amount)} · {PAYMENT_STATUS[p.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```
`src/app/app/billing/complete/page.tsx`:
```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

function Complete() {
  const params = useSearchParams();
  const router = useRouter();
  const started = useRef(false);
  const [message, setMessage] = useState("결제를 확인하고 있어요…");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const billingKey = params.get("billingKey");
    const plan = params.get("plan");
    if (params.get("code") || !billingKey || (plan !== "pro" && plan !== "agency")) {
      toast.error(params.get("message") ?? "카드 등록이 취소됐어요");
      router.replace("/app/billing");
      return;
    }
    void (async () => {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan, billingKey }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (body.ok) toast.success("결제가 완료됐어요");
      else toast.error(body.error ?? "결제에 실패했어요");
      setMessage("결제 페이지로 이동해요…");
      router.replace("/app/billing");
      router.refresh();
    })();
  }, [params, router]);

  return <p className="py-20 text-center text-sm text-muted-foreground">{message}</p>;
}

export default function BillingCompletePage() {
  return (
    <Suspense>
      <Complete />
    </Suspense>
  );
}
```

- [ ] **Step 8: 워커에 갱신 잡 추가 (`src/worker/index.ts`)**

import 추가:
```ts
import { createBillingDeps } from "@/server/billing/deps";
import { billingConfigured } from "@/server/billing/gateway";
import { processDueRenewals } from "@/server/billing/subscriptions";
```
`jobs` 배열 정의 직후에 추가:
```ts
  if (billingConfigured()) {
    jobs.push({
      name: "billing-renewals",
      intervalMs: 10 * MINUTE,
      run: async () => {
        const count = await processDueRenewals(createBillingDeps(db));
        if (count > 0) log.info("billing renewals processed", { count });
      },
    });
  }
```
(`const jobs: ScheduledJob[] = [...]`는 그대로 두고 `push`만 추가한다.)

- [ ] **Step 9: 통과·빌드 확인**

Run: `pnpm vitest run --project integration tests/integration/portone-webhook.test.ts && pnpm typecheck && pnpm lint && pnpm build && pnpm build:worker`
Expected: 모두 성공

- [ ] **Step 10: 테스트 채널로 수동 결제 확인 (포트원 테스트 키가 있을 때)**

1. 포트원 콘솔에서 테스트 모드와 테스트 채널을 준비한다. 채널은 KG이니시스 `INIBillTst` 또는 토스페이먼츠 `iamporttest_4`다.
2. `.env`에 `PORTONE_STORE_ID`, `PORTONE_CHANNEL_KEY`, `PORTONE_API_SECRET`, `PORTONE_WEBHOOK_SECRET`을 채운다.
3. `pnpm dev`를 실행하고 `/app/billing`에서 Pro를 고른 뒤 이름·휴대폰을 입력한다.
4. 테스트 카드를 등록한다.

Expected: "Pro 플랜이 시작됐어요" 토스트가 뜬다. 결제 내역에 "9,900원 · 결제 완료"가 표시된다. 테스트 결제는 당일 밤 자동 취소된다.

키가 없으면 이 단계를 건너뛰고, 최종 보고에 "결제 수동 확인은 테스트 키 발급 후"라고 적는다.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add billing page, PortOne billing key flow, webhook sync and renewal job"
```

---

### Task 19: 설정(계정 연결 해제·회원 탈퇴)과 데이터 삭제 상태 페이지

**Files:**
- Create: `src/server/account.ts`, `src/app/app/settings/page.tsx`, `src/app/app/settings/actions.ts`, `src/components/app/settings-actions.tsx`, `src/app/data-deletion/[code]/page.tsx`
- Test: `tests/integration/account.test.ts`

**Interfaces:**
- Consumes: `disconnectIgAccounts`, `BillingGateway`, `getBillingGateway`, `billingConfigured`, `decryptSecret`, `getUserPlan`
- Produces:
  - `disconnectAccount(db, userId, accountId): Promise<boolean>`
  - `deleteUserAccount(deps: { db; gateway: BillingGateway | null; decrypt }, userId): Promise<void>`
  - 서버 액션 `disconnectAccountAction(accountId)`, `deleteMyAccountAction(confirm: string)`

- [ ] **Step 1: 실패하는 테스트 작성 (`tests/integration/account.test.ts`)**

```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteUserAccount, disconnectAccount } from "@/server/account";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { automations, igAccounts, payments, user } from "@/server/db/schema";
import { resetDb } from "../helpers/db";
import { createAutomation, createIgAccount, createUser, setPlan } from "../helpers/factories";
import { FakeBillingGateway } from "../helpers/fake-billing";

describe("account management", () => {
  beforeEach(resetDb);

  it("disconnects only the owner's account and turns its automations off", async () => {
    const owner = await createUser();
    const other = await createUser();
    const acct = await createIgAccount(owner.id);
    await createAutomation(acct);
    expect(await disconnectAccount(getDb(), other.id, acct.id)).toBe(false);
    expect(await disconnectAccount(getDb(), owner.id, acct.id)).toBe(true);
    const [a] = await getDb().select().from(igAccounts).where(eq(igAccounts.id, acct.id));
    expect(a).toMatchObject({ status: "disconnected", accessTokenEnc: null });
    const [auto] = await getDb().select().from(automations);
    expect(auto.isActive).toBe(false);
  });

  it("deletes the user, their data and billing key but keeps payment records", async () => {
    const u = await createUser();
    const acct = await createIgAccount(u.id);
    await createAutomation(acct);
    const s = await setPlan(u.id, "pro", { billingKeyEnc: encryptSecret("bk_9") });
    await getDb().insert(payments).values({ userId: u.id, subscriptionId: s.id, paymentId: "pay_1", plan: "pro", amount: 9900, status: "paid" });
    const gateway = new FakeBillingGateway();
    await deleteUserAccount({ db: getDb(), gateway, decrypt: decryptSecret }, u.id);
    expect(gateway.deleted).toEqual(["bk_9"]);
    expect(await getDb().select().from(user)).toHaveLength(0);
    expect(await getDb().select().from(igAccounts)).toHaveLength(0);
    const [p] = await getDb().select().from(payments);
    expect(p).toMatchObject({ paymentId: "pay_1", userId: null, subscriptionId: null });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run --project integration tests/integration/account.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `src/server/account.ts`**

```ts
import { and, eq } from "drizzle-orm";
import type { BillingGateway } from "@/server/billing/gateway";
import type { Db } from "@/server/db/client";
import { igAccounts, subscriptions, user } from "@/server/db/schema";
import { disconnectIgAccounts } from "@/server/instagram/meta-callbacks";
import { errorFields, log } from "@/server/log";

export async function disconnectAccount(db: Db, userId: string, accountId: string): Promise<boolean> {
  const [acct] = await db
    .select({ id: igAccounts.id })
    .from(igAccounts)
    .where(and(eq(igAccounts.id, accountId), eq(igAccounts.userId, userId)))
    .limit(1);
  if (!acct) return false;
  await disconnectIgAccounts(db, [acct.id]);
  return true;
}

export async function deleteUserAccount(
  deps: { db: Db; gateway: BillingGateway | null; decrypt: (s: string) => string },
  userId: string,
): Promise<void> {
  const [sub] = await deps.db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  if (sub?.billingKeyEnc && deps.gateway) {
    try {
      await deps.gateway.deleteBillingKey(deps.decrypt(sub.billingKeyEnc));
    } catch (e) {
      log.error("billing key deletion failed during account deletion", errorFields(e));
    }
  }
  // payments.user_id / subscription_id 는 ON DELETE SET NULL 이라 결제 기록은 남는다.
  await deps.db.delete(user).where(eq(user.id, userId));
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run --project integration tests/integration/account.test.ts`
Expected: PASS

- [ ] **Step 5: 액션과 설정 화면**

`src/app/app/settings/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { deleteUserAccount, disconnectAccount } from "@/server/account";
import { billingConfigured, getBillingGateway } from "@/server/billing/gateway";
import { decryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";

export async function disconnectAccountAction(accountId: string): Promise<boolean> {
  const user = await requireUser();
  if (!z.uuid().safeParse(accountId).success) return false;
  const ok = await disconnectAccount(getDb(), user.id, accountId);
  revalidatePath("/app/settings");
  revalidatePath("/app");
  return ok;
}

export async function deleteMyAccountAction(confirm: string): Promise<{ ok: false; error: string } | never> {
  const user = await requireUser();
  if (confirm.trim() !== "탈퇴") return { ok: false, error: "'탈퇴'를 정확히 입력해주세요" };
  await deleteUserAccount(
    { db: getDb(), gateway: billingConfigured() ? getBillingGateway() : null, decrypt: decryptSecret },
    user.id,
  );
  redirect("/?deleted=1");
}
```
`src/components/app/settings-actions.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteMyAccountAction, disconnectAccountAction } from "@/app/app/settings/actions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DisconnectButton({ accountId, username }: { accountId: string; username: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        연결 해제
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>@{username} 연결을 해제할까요?</AlertDialogTitle>
            <AlertDialogDescription>이 계정의 자동화가 모두 꺼지고 더 이상 댓글에 반응하지 않아요. 나중에 다시 연결할 수 있어요.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  if (await disconnectAccountAction(accountId)) toast.success("연결을 해제했어요");
                  else toast.error("해제하지 못했어요");
                  setOpen(false);
                })
              }
            >
              연결 해제
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button variant="ghost" className="text-destructive" onClick={() => setOpen(true)}>
        회원 탈퇴
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>정말 탈퇴할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              연결된 인스타 계정, 자동화, 발송 기록이 모두 삭제되고 정기결제가 중단돼요. 결제 기록은 법령에 따라 5년간 보관돼요. 계속하려면 &lsquo;탈퇴&rsquo;를 입력하세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="탈퇴" />
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending || confirm.trim() !== "탈퇴"}
              onClick={() =>
                startTransition(async () => {
                  const res = await deleteMyAccountAction(confirm);
                  if (res && !res.ok) toast.error(res.error);
                })
              }
            >
              탈퇴하기
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```
`src/app/app/settings/page.tsx`:
```tsx
import { and, asc, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { DeleteAccountButton, DisconnectButton } from "@/components/app/settings-actions";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getUserPlan } from "@/server/billing/plan-of";
import { getDb } from "@/server/db/client";
import { igAccounts } from "@/server/db/schema";
import { requireUser } from "@/server/session";

export const metadata = { title: "설정" };

export default async function SettingsPage() {
  const user = await requireUser();
  const db = getDb();
  const accounts = await db
    .select()
    .from(igAccounts)
    .where(and(eq(igAccounts.userId, user.id), ne(igAccounts.status, "disconnected")))
    .orderBy(asc(igAccounts.createdAt));
  const plan = await getUserPlan(db, user.id);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">설정</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            인스타그램 계정 ({accounts.length}/{plan.maxIgAccounts})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">@{a.username}</p>
                {a.status === "active" ? (
                  <Badge variant="secondary">연결됨</Badge>
                ) : (
                  <Badge variant="destructive">다시 연결 필요</Badge>
                )}
              </div>
              <div className="flex gap-2">
                {a.status !== "active" && (
                  <a href="/api/instagram/connect" className={buttonVariants({ size: "sm" })}>
                    다시 연결
                  </a>
                )}
                <DisconnectButton accountId={a.id} username={a.username} />
              </div>
            </div>
          ))}
          {accounts.length < plan.maxIgAccounts ? (
            <a href="/api/instagram/connect" className={buttonVariants({ variant: "outline", className: "w-full" })}>
              인스타그램 계정 연결
            </a>
          ) : (
            plan.id !== "agency" && (
              <p className="text-xs text-muted-foreground">
                더 많은 계정을 연결하려면 <Link href="/app/billing" className="underline">Agency 플랜</Link>이 필요해요.
              </p>
            )
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">내 계정</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">{user.email}</p>
          <div className="flex flex-wrap gap-3 text-xs">
            <Link href="/terms" className="underline">이용약관</Link>
            <Link href="/privacy" className="underline">개인정보처리방침</Link>
            <Link href="/refund" className="underline">환불정책</Link>
          </div>
          <DeleteAccountButton />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: 데이터 삭제 상태 페이지 (`src/app/data-deletion/[code]/page.tsx`)**

```tsx
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { site } from "@/lib/site";
import { getDb } from "@/server/db/client";
import { dataDeletionRequests } from "@/server/db/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "데이터 삭제 요청" };

export default async function DataDeletionStatusPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(code)) notFound();
  const [req] = await getDb().select().from(dataDeletionRequests).where(eq(dataDeletionRequests.confirmationCode, code));
  if (!req) notFound();
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-xl font-bold">데이터 삭제 요청</h1>
      <p className="mt-4 text-sm text-muted-foreground">확인 코드: {req.confirmationCode}</p>
      <p className="mt-2 text-sm">
        상태: {req.status === "completed" ? "삭제 완료" : "처리 중"}
        {req.completedAt && ` (${req.completedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })})`}
      </p>
      <p className="mt-6 text-xs text-muted-foreground">
        {site.name}에 저장된 해당 인스타그램 계정의 연동 정보, 자동화, 댓글 처리 기록을 삭제했어요. 문의: {site.supportEmail}
      </p>
    </main>
  );
}
```

- [ ] **Step 7: 빌드·확인**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: 오류 없음. `pnpm dev`에서 `/app/settings`의 연결 해제 다이얼로그와 탈퇴 다이얼로그가 열리고 닫힌다. 탈퇴 버튼은 '탈퇴'를 입력하기 전까지 비활성 상태다.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add settings with account disconnect, account deletion and data deletion status page"
```

---

### Task 20: 배포 (Docker, Compose, 백업, CI/CD, 런북, 시뮬레이터)

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `deploy/docker-compose.yml`, `deploy/docker-compose.smoke.yml`, `deploy/.env.example`, `deploy/backup.sh`
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `scripts/simulate-comment.ts`, `docs/runbook.md`

**Interfaces:**
- Consumes: `pnpm build`, `pnpm build:worker`, `/api/health?strict=1`, `IG_APP_SECRET`
- Produces: 컨테이너 이미지(web: `node server.js`, worker: `node dist/worker.mjs`, migrate: `node dist/migrate.mjs`), main push 시 자동 배포

- [ ] **Step 1: `Dockerfile`과 `.dockerignore`**

`Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build && pnpm build:worker

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/drizzle ./drizzle
USER app
EXPOSE 3000
CMD ["node", "server.js"]
```
`.dockerignore`:
```
node_modules
.next
dist
coverage
.git
.env
.env.*
deploy/.env*
deploy/backups
tests
docs
```

- [ ] **Step 2: `deploy/docker-compose.yml`**

```yaml
name: igcomment

x-app: &app
  image: ${IMAGE:?IMAGE is required}
  env_file: ${ENV_FILE:-.env}
  environment:
    DATABASE_URL: postgres://igc:${POSTGRES_PASSWORD}@postgres:5432/igc
  networks: [internal]

services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: igc
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
      POSTGRES_DB: igc
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U igc -d igc"]
      interval: 5s
      timeout: 3s
      retries: 20
    networks: [internal]

  migrate:
    <<: *app
    command: ["node", "dist/migrate.mjs"]
    restart: "no"
    depends_on:
      postgres:
        condition: service_healthy

  web:
    <<: *app
    restart: unless-stopped
    depends_on:
      migrate:
        condition: service_completed_successfully
    networks: [internal, traefik]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    labels:
      - traefik.enable=true
      - traefik.docker.network=${TRAEFIK_NETWORK:?TRAEFIK_NETWORK is required}
      - traefik.http.routers.igcomment.rule=Host(`${APP_DOMAIN:?APP_DOMAIN is required}`)
      - traefik.http.routers.igcomment.entrypoints=${TRAEFIK_ENTRYPOINT:-websecure}
      - traefik.http.routers.igcomment.tls=true
      - traefik.http.routers.igcomment.tls.certresolver=${TRAEFIK_CERTRESOLVER:?TRAEFIK_CERTRESOLVER is required}
      - traefik.http.services.igcomment.loadbalancer.server.port=3000

  worker:
    <<: *app
    command: ["node", "dist/worker.mjs"]
    restart: unless-stopped
    stop_grace_period: 30s
    depends_on:
      migrate:
        condition: service_completed_successfully

  backup:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      PGHOST: postgres
      PGUSER: igc
      PGPASSWORD: ${POSTGRES_PASSWORD}
      PGDATABASE: igc
      TZ: Asia/Seoul
    volumes:
      - ./backups:/backups
      - ./backup.sh:/backup.sh:ro
    entrypoint: ["/bin/sh", "/backup.sh"]
    depends_on:
      postgres:
        condition: service_healthy
    networks: [internal]

volumes:
  pgdata: {}

networks:
  internal: {}
  traefik:
    external: true
    name: ${TRAEFIK_NETWORK}
```
`deploy/docker-compose.smoke.yml` (로컬 검증용: 3100 포트 노출):
```yaml
services:
  web:
    ports:
      - "3100:3000"
```
`deploy/backup.sh`:
```sh
#!/bin/sh
set -eu
mkdir -p /backups
echo "backup loop started (daily 03:00 KST, keep 7 days)"
while true; do
  if [ "$(date +%H%M)" = "0300" ]; then
    file="/backups/igc-$(date +%Y%m%d-%H%M).dump"
    if pg_dump -Fc -f "$file.tmp"; then
      mv "$file.tmp" "$file"
      echo "backup ok: $file"
    else
      rm -f "$file.tmp"
      echo "backup FAILED" >&2
    fi
    find /backups -name 'igc-*.dump' -mtime +7 -delete
    sleep 61
  fi
  sleep 30
done
```
`deploy/.env.example`:
```dotenv
# ---- 배포 (compose 보간용) ----
IMAGE=ghcr.io/OWNER/REPO:latest
APP_DOMAIN=example.com
TRAEFIK_NETWORK=traefik
TRAEFIK_ENTRYPOINT=websecure
TRAEFIK_CERTRESOLVER=letsencrypt
# openssl rand -hex 24 (URL에 들어가므로 hex 권장)
POSTGRES_PASSWORD=

# ---- 앱 ----
APP_URL=https://example.com
BETTER_AUTH_SECRET=
ENCRYPTION_KEY=
KAKAO_CLIENT_ID=
KAKAO_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
RESEND_API_KEY=
EMAIL_FROM=리치업 <noreply@example.com>
IG_APP_ID=
IG_APP_SECRET=
META_APP_SECRET=
IG_WEBHOOK_VERIFY_TOKEN=
IG_GRAPH_API_VERSION=v26.0
IG_PRIVATE_REPLY_HOURLY_LIMIT=700
WORKER_CONCURRENCY=8
PORTONE_STORE_ID=
PORTONE_CHANNEL_KEY=
PORTONE_API_SECRET=
PORTONE_WEBHOOK_SECRET=
```

- [ ] **Step 3: 시뮬레이터 (`scripts/simulate-comment.ts`)**

```ts
import { createHmac, randomInt } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "ig-user-id": { type: "string" },
    "media-id": { type: "string", default: "sim-media-1" },
    text: { type: "string", default: "공구" },
    "comment-id": { type: "string" },
    "from-id": { type: "string" },
    username: { type: "string", default: "sim_follower" },
    url: { type: "string" },
  },
});

const secret = process.env.IG_APP_SECRET;
const igUserId = values["ig-user-id"];
if (!secret || !igUserId) {
  console.error("usage: IG_APP_SECRET=... pnpm simulate:comment --ig-user-id <IG 프로페셔널 계정 ID> [--text 공구] [--media-id ..] [--comment-id ..] [--url http://localhost:3000]");
  process.exit(1);
}

const body = JSON.stringify({
  object: "instagram",
  entry: [
    {
      id: igUserId,
      time: Math.floor(Date.now() / 1000),
      changes: [
        {
          field: "comments",
          value: {
            from: { id: values["from-id"] ?? `sim-${randomInt(1_000_000_000)}`, username: values.username },
            media: { id: values["media-id"], media_product_type: "REELS" },
            id: values["comment-id"] ?? `sim-${Date.now()}`,
            text: values.text,
          },
        },
      ],
    },
  ],
});

const target = `${values.url ?? process.env.APP_URL ?? "http://localhost:3000"}/api/webhooks/instagram`;
const res = await fetch(target, {
  method: "POST",
  headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` },
  body,
});
console.log(res.status, await res.text());
```

- [ ] **Step 4: GitHub Actions**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  pull_request:
  workflow_call:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: igc_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-timeout 3s --health-retries 20
    env:
      TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/igc_test
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
```
`.github/workflows/deploy.yml`:
```yaml
name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-production
  cancel-in-progress: false

jobs:
  ci:
    uses: ./.github/workflows/ci.yml

  build:
    needs: ci
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    outputs:
      image: ${{ steps.meta.outputs.image }}
    steps:
      - uses: actions/checkout@v5
      - id: meta
        run: |
          repo="${GITHUB_REPOSITORY,,}"
          echo "image=ghcr.io/${repo}:${GITHUB_SHA}" >> "$GITHUB_OUTPUT"
          echo "latest=ghcr.io/${repo}:latest" >> "$GITHUB_OUTPUT"
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ${{ steps.meta.outputs.image }}
            ${{ steps.meta.outputs.latest }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          port: ${{ secrets.VPS_PORT || 22 }}
          script: |
            set -e
            cd "${{ secrets.VPS_APP_DIR }}"
            sed -i "s|^IMAGE=.*|IMAGE=${{ needs.build.outputs.image }}|" .env
            docker compose pull migrate web worker
            docker compose up -d --remove-orphans
            domain="$(grep '^APP_DOMAIN=' .env | cut -d= -f2)"
            for i in $(seq 1 30); do
              if curl -fsS "https://${domain}/api/health?strict=1" > /dev/null; then echo "healthy"; exit 0; fi
              sleep 5
            done
            echo "health check failed"
            docker compose logs --tail=100 web worker
            exit 1
```
- [ ] **Step 5: 런북 (`docs/runbook.md`)**

````markdown
# 운영 런북

## 1. 최초 준비 (1회)

### 1-1. 도메인·DNS
- 도메인 구매 후 A 레코드 `@` → VPS IP. (`www`를 쓰면 CNAME `www` → `@`)

### 1-2. VPS
```bash
sudo mkdir -p /opt/igcomment && sudo chown $USER /opt/igcomment && cd /opt/igcomment
# 저장소의 deploy/ 파일 3개를 복사
scp deploy/docker-compose.yml deploy/backup.sh deploy/.env.example <vps>:/opt/igcomment/
cp .env.example .env && chmod 600 .env   # 값 채우기 (아래 표)
docker network ls                         # Traefik이 붙은 네트워크 이름 → TRAEFIK_NETWORK
docker inspect <traefik 컨테이너> | grep -i certresolver   # certresolver 이름 → TRAEFIK_CERTRESOLVER
echo <GHCR read:packages 토큰> | docker login ghcr.io -u <github 사용자> --password-stdin
```
| 변수 | 만드는 법 |
|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` — **분실 시 저장된 토큰·빌링키 복호화 불가. 별도 보관** |
| `IG_WEBHOOK_VERIFY_TOKEN` | `openssl rand -hex 16` |

### 1-3. GitHub
- Repository secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`(배포 전용 키), `VPS_PORT`(선택), `VPS_APP_DIR=/opt/igcomment`
- Environments에 `production` 생성(필요 시 승인자 지정)
- 첫 배포: main에 push → Actions 성공 → `https://<도메인>/api/health?strict=1` 이 `{"ok":true,...}`

## 2. Meta(Instagram) 앱 설정
1. developers.facebook.com → 앱 만들기 → 유형 **Business** → 사용 사례 "Instagram API 설정(Instagram 로그인)"
2. Instagram > API setup with Instagram login
   - **Instagram App ID / Secret** → `IG_APP_ID`, `IG_APP_SECRET`
   - 앱 설정 > 기본의 앱 시크릿 → `META_APP_SECRET`
3. Business login settings
   - OAuth redirect URI: `https://<도메인>/api/instagram/callback`
   - Deauthorize callback: `https://<도메인>/api/meta/deauthorize`
   - Data deletion request URL: `https://<도메인>/api/meta/data-deletion`
4. Webhooks: Callback URL `https://<도메인>/api/webhooks/instagram`, Verify token = `IG_WEBHOOK_VERIFY_TOKEN`, 필드 `comments` 구독
5. 앱 역할 > 테스터로 본인 인스타 계정 추가(인스타 앱 설정 > 앱 및 웹사이트 > 테스터 초대 수락)
6. 앱 설정: 개인정보처리방침 URL `https://<도메인>/privacy`, 이용약관 `https://<도메인>/terms`, 앱 아이콘, 카테고리
7. 비즈니스 인증(Business Verification) 진행
8. 앱 검수(Advanced Access): `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`
   - 권한별로 1회 이상 성공 호출(테스터 계정으로 E2E 1회 수행)
   - 영어 UI 시연 영상(연동 → 자동화 생성 → 실제 댓글 → 답글/DM 수신)
9. 승인 후 앱을 **Live**로 전환 (Live가 아니면 웹훅이 오지 않을 수 있음)

## 3. 소셜 로그인
- 카카오: developers.kakao.com → 앱 → 카카오 로그인 활성화 → Redirect URI `https://<도메인>/api/auth/callback/kakao` → 동의항목 이메일(비즈앱 전환 필요) → `KAKAO_CLIENT_ID`(REST API 키)/`KAKAO_CLIENT_SECRET`
- 구글: console.cloud.google.com → OAuth 클라이언트(웹) → 승인된 리디렉션 URI `https://<도메인>/api/auth/callback/google`
- 키를 비워두면 해당 로그인 버튼이 숨겨지고 이메일 링크 로그인만 노출됨

## 4. 이메일 (Resend)
- resend.com → 도메인 추가 → DNS(SPF/DKIM) 등록 → API 키 → `RESEND_API_KEY`, `EMAIL_FROM="리치업 <noreply@<도메인>>"`

## 5. 포트원 V2
1. 포트원 콘솔 → 테스트 모드 → 채널 추가: KG이니시스(빌링) `INIBillTst` 또는 토스페이먼츠 `iamporttest_4`
2. `PORTONE_STORE_ID`(상점 ID), `PORTONE_CHANNEL_KEY`, V2 API Secret → `PORTONE_API_SECRET`
3. 결제알림(Webhook) 관리 → 결제모듈 V2 → 버전 `2024-04-25` → URL `https://<도메인>/api/webhooks/portone` → 시크릿 → `PORTONE_WEBHOOK_SECRET`
4. 라이브: PG 정기결제 계약 → 카드사 심사 → 실연동 채널 키로 교체 → 실연동 웹훅 URL/시크릿 별도 설정
5. PG 심사 전 `src/lib/site.ts`의 사업자 정보·호스팅 업체·개인정보 보호책임자를 반드시 입력

## 6. 수동 E2E (테스터 계정)
1. 로그인 → 온보딩 → 인스타 연결 → 자동화(특정 게시물, 키워드 "테스트") 켜기
2. 다른 인스타 계정으로 해당 게시물에 "테스트" 댓글
3. 10초 안에 공개 답글·DM 수신, 대시보드 "성공" 1 증가, (Pro) DM 링크 클릭 후 클릭 1 증가
4. 웹훅이 안 오면: 앱 Live/Advanced Access 상태 확인. 임시로 서버에서 시뮬레이터 실행
   `docker compose exec web node -e "…"` 대신 로컬에서: `IG_APP_SECRET=… pnpm simulate:comment --url https://<도메인> --ig-user-id <계정ID> --comment-id <실제 댓글 ID> --text 테스트`

## 7. 운영
- 로그: `docker compose logs -f --tail=200 web worker` (JSON 한 줄 로그)
- 발송 대기 적체 확인:
  `docker compose exec postgres psql -U igc -c "select status, count(*) from comment_events group by 1"`
- 롤백: `.env`의 `IMAGE=`를 이전 태그(`ghcr.io/…:<sha>`)로 바꾸고 `docker compose up -d`
- 백업 위치: `/opt/igcomment/backups/igc-YYYYMMDD-0300.dump` (7일 보관, 외부 저장소 복사 권장)
- 복구:
  ```bash
  docker compose stop web worker
  docker compose exec -T postgres pg_restore -U igc -d igc --clean --if-exists < backups/igc-YYYYMMDD-0300.dump
  docker compose start web worker
  ```
- 결제 응답 유실로 결제는 됐는데 플랜이 안 바뀐 경우: 포트원 웹훅이 자동 동기화한다. 웹훅도 실패했다면 포트원 콘솔에서 해당 결제를 확인 후 환불하거나 운영자가 수동으로 `subscriptions`를 수정한다.
````

- [ ] **Step 6: 이미지 빌드와 로컬 스모크 테스트**

```bash
docker build -t igcomment:local .
cp deploy/.env.example deploy/.env.smoke
```
`deploy/.env.smoke`를 다음 값으로 채운다.
- 이미지와 도메인: `IMAGE=igcomment:local`, `APP_DOMAIN=localhost`, `APP_URL=http://localhost:3100`
- Traefik: `TRAEFIK_NETWORK=igc-smoke-traefik`, `TRAEFIK_CERTRESOLVER=none`
- 비밀값: `POSTGRES_PASSWORD`는 `openssl rand -hex 24`로 만들고, `BETTER_AUTH_SECRET`과 `ENCRYPTION_KEY`는 각각 `openssl rand -base64 32`로 만든다.
- Instagram: `IG_APP_ID=smoke`, `IG_APP_SECRET=smoke-secret`, `IG_WEBHOOK_VERIFY_TOKEN=smoke-verify-token`

```bash
docker network create igc-smoke-traefik || true
cd deploy
ENV_FILE=.env.smoke docker compose --env-file .env.smoke -p igc-smoke -f docker-compose.yml -f docker-compose.smoke.yml up -d
sleep 20
curl -fsS "http://localhost:3100/api/health?strict=1"
curl -fsS -o /dev/null -w "%{http_code}\n" http://localhost:3100/
docker compose -p igc-smoke logs --tail=20 worker
```
Expected:
- health는 `{"ok":true,"db":true,"worker":true}`를 반환하고, `/`는 `200`을 반환한다.
- worker 로그에 `worker started`가 찍힌다.
- migrate 컨테이너는 `exited (0)`이다.

정리:
```bash
ENV_FILE=.env.smoke docker compose --env-file .env.smoke -p igc-smoke -f docker-compose.yml -f docker-compose.smoke.yml down -v
cd ..
```

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore deploy/docker-compose.yml deploy/docker-compose.smoke.yml deploy/.env.example deploy/backup.sh .github scripts/simulate-comment.ts docs/runbook.md
git commit -m "chore: add Docker image, compose deployment with Traefik, backups, CI/CD and runbook"
```

---

### Task 21: 최종 검증과 spec 동기화

**Files:**
- Modify: `docs/superpowers/specs/2026-09-24-instagram-comment-automation-design.md`(구현 중 바뀐 결정 반영)

- [ ] **Step 1: 전체 검증**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm build:worker`
Expected: 모두 성공. `pnpm test` 출력에 unit·integration 두 프로젝트의 전체 테스트가 PASS로 나온다.

- [ ] **Step 2: 로컬 E2E (웹훅 → 워커 → 결과 기록)**

1. `pnpm dev`와 `pnpm worker:dev`를 각각 실행한다. 둘 다 dev DB를 쓴다.
2. 로그인한 뒤 Task 16 Step 12의 SQL로 데모 계정을 넣는다. 토큰이 있어야 발송 단계까지 가므로 다음 SQL로 암호화된 가짜 토큰을 넣는다.
   ```bash
   pnpm tsx --env-file=.env -e "import('./src/server/crypto.ts').then(m=>console.log(m.encryptSecret('fake-token')))"
   psql postgres://postgres:postgres@localhost:54329/igc_dev -c "update ig_accounts set access_token_enc='<출력값>' where ig_user_id='17841400000000001'"
   ```
3. 위자드로 "모든 게시물 / 키워드 공구" 자동화를 켠다.
4. 시뮬레이터로 댓글 웹훅을 보낸다: `pnpm simulate:comment --ig-user-id 17841400000000001 --text 공구요`

Expected:
- 시뮬레이터가 `200 ok`를 출력한다.
- 워커 로그에 `event processed`가 찍히고 outcome이 `failed`다. 가짜 토큰이라 Instagram이 190을 반환하는 것이 정상이다.
- 대시보드 최근 발송에 "실패 · 인스타 연결이 만료됐어요"가 보이고, 계정에 "다시 연결 필요" 배너가 뜬다.
- 이로써 웹훅 → 큐 → 워커 → Graph 호출 → 오류 분류 → 대시보드까지 경로 전체가 확인된다.

- [ ] **Step 3: 모바일 화면 점검**

Browser pane을 모바일(375×812)로 맞춘 뒤 `/`, `/pricing`, `/login`, `/app`, `/app/automations/new`, `/app/billing`, `/app/settings`를 확인한다.
Expected: 가로 스크롤이 없고, 하단 내비가 콘텐츠를 가리지 않으며, 버튼 터치 영역이 충분하다.

- [ ] **Step 4: spec 동기화**

spec에 다음을 반영한다.
- 7.8 동시성: 결제 직렬화를 `pg_advisory_xact_lock`에서 `subscriptions.billing_locked_until` 리스(2분)로 바꾼다. 외부 결제 호출 전에 결제 행을 커밋하기 위해서다.
- 10 환경변수: `NEXT_PUBLIC_PORTONE_*`를 제거한다. 결제 화면은 서버 컴포넌트가 `PORTONE_STORE_ID`/`PORTONE_CHANNEL_KEY`를 props로 넘긴다.
- 11 배포: `/api/health`는 DB만 보고, `?strict=1`일 때만 워커 하트비트도 확인한다. Traefik이 unhealthy 컨테이너를 라우팅에서 빼기 때문이다.
- 5 데이터 모델: `subscriptions.billing_locked_until`을 추가한다.
- 8 화면: 사업자 정보 미입력 시 "빌드 시 경고" 대신, 법적 페이지에 노란 "[… 입력 필요]"로 표시한다.
- 4 디렉터리: `server-only` 패키지는 쓰지 않는다. 워커 번들과 Vitest가 같은 모듈을 불러오기 때문이다.

```bash
git add docs/superpowers/specs
git commit -m "docs(spec): sync billing lease, env and health check decisions"
```

- [ ] **Step 5: 원격 저장소와 첫 배포는 사용자 확인 후**

GitHub 저장소를 만들고 push하는 일, VPS에 `.env`를 두는 일, DNS를 연결하는 일은 모두 외부에 영향을 준다. 그래서 사용자에게 다음 세 가지를 확인받은 뒤 진행한다.
- 저장소 이름과 공개 여부
- VPS 접속 정보를 GitHub secrets에 넣는 방법
- 도메인
