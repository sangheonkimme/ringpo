# 공구 캠페인 운영 절차

갱신일: 2026-10-22. 구현 단계: **M2-2b 성과 리포트·브랜드 공유·PDF**. 운영 배포 전이다. webhook·공유 발송 예산·worker·예상 완료 시각·리포트 기능을 분리 환경에서 검증했다. 실제 Meta 두 계정 점검과 FAQ echo 검증 전에는 일반 계정에서 플래그를 켜지 않는다.

## 기능 플래그와 롤백

`gonggu_campaigns`의 전체 스위치가 계정별 override보다 우선한다. 마이그레이션 기본값은 전체 OFF, 기본 계정 OFF다. DB 변경은 대상 환경을 확인한 운영자가 수행한다.

```sql
-- 먼저 대상 DB/서버를 확인한다.
SELECT current_database(), inet_server_addr(), inet_server_port();
SELECT * FROM feature_flags WHERE key = 'gonggu_campaigns';

-- 전체 중단. 캠페인 화면/수정/예약 상태 전환이 멈춘다.
UPDATE feature_flags SET enabled = false, updated_at = now()
WHERE key = 'gonggu_campaigns';
```

테스트 계정만 허용하려면 전체 `enabled=true, default_enabled=false`로 두고 해당 계정의 `feature_flag_overrides`를 설정한다. 전체 계정을 일괄 허용하는 `default_enabled=true`는 실제 Meta 두 계정 점검과 발송 부하 검증 이후의 배포 단계다.

```sql
BEGIN;
UPDATE feature_flags SET enabled = true, default_enabled = false, updated_at = now()
WHERE key = 'gonggu_campaigns';
-- psql의 account_id 변수에 확인된 테스트 계정 UUID를 지정한 뒤 실행한다.
INSERT INTO feature_flag_overrides (flag_key, ig_account_id, enabled)
VALUES ('gonggu_campaigns', :'account_id'::uuid, true)
ON CONFLICT (flag_key, ig_account_id) DO UPDATE SET enabled = EXCLUDED.enabled;
COMMIT;
```

기능 롤백은 플래그를 끄고 additive 스키마를 남기는 방법을 우선한다. `drizzle/rollback/0002_gonggu_foundation.sql`은 **캠페인 데이터가 없고 더 최신 마이그레이션도 없을 때만** 실행된다. 데이터를 보유한 환경에서는 DROP 거부를 우회하지 않는다. up→down→up과 데이터 보유 시 거부를 통합 테스트로 확인한다. 이 PR의 상태 전환은 재시작 후 재개되며 플래그 OFF 중 지나간 예약도 ON 후 현재 시각까지 따라잡는다.

## 캠페인 상태 변경·미디어 연결 해제

1. 셀러 로그인 → 공구 탭 → 대상 공구 상세를 연다.
2. 초안은 `공개 및 오픈 예약`으로 공개한다. Pro의 `예고 시작`은 예약 알림을 받을 단계를 활성화한다. 현재 실행 worker는 댓글을 받아 공개 답글·예약 DM 잡을 만들고 만료·복구를 처리한다. M1-4d의 sender가 계정 예산 안에서 송신한다.
3. 공개 예약/예고 상태에서는 `지금 오픈`, 진행 상태에서는 `마감` 또는 `품절 처리`를 누른다. 마감/품절 후에는 `정산 확정`이 가능하다. 정산 시점의 리포트 버전 생성도 같은 transaction에서 예약한다.
4. `연결 해제 및 보관`은 목록에서 숨기고 다른 캠페인에서 게시물을 사용할 수 있게 한다. 기록은 보존한다.
5. 운영 이력에서 실행 시각, 실행 주체, 상태 변경을 확인한다. 예약의 효력 시각은 `campaign_audit_events.effective_at`, 실제 처리 시각은 `created_at` 및 캠페인의 실제 전환 시각이다.

다른 창에서 수정했다면 새로고침 후 다시 실행한다. 직접 SQL로 status만 바꾸면 version·감사·예약 불변식을 깨므로 사용하지 않는다. 역방향 재오픈은 허용하지 않는다. 종료 캠페인의 미디어는 명시적으로 연결을 해제하기 전까지 그 캠페인에 남는다.

## 권한 설정

`plan_entitlements`가 공구 권한의 원천이다. `campaign.max_active`는 `kind=limit`; NULL은 무제한이다. Boolean 기능은 `kind=boolean, boolean_value=true/false`로 관리한다. 기본 Free 활성 1개/기본 클릭, Pro 활성 무제한/전체 기능이다. 발송량은 새 캠페인 quota로 사용하지 않는다. 기존 게시물 자동화의 플랜 동작은 그대로 유지한다.

활성 수는 셀러의 모든 IG 계정에 걸쳐 공개 예약 DRAFT/TEASER/OPEN을 합산한다. 동시 공개 요청도 같은 셀러 잠금으로 직렬화한다. 정책 수치는 `campaign_policies`에서 관리하며, 누락된 필수 설정은 추정값으로 대체하지 않고 작업을 거부한다.

## 후속 PR에서 제공할 운영 기능

| 절차 | 현재 상태·필수 정책 |
| --- | --- |
| 계정 전체 일시정지/재개·자동 breaker | M1-4d에서 기존 팔로우 일반 DM까지 공통 예산 연결. 실제 두 계정 검증 전 일반 공개 금지 |
| 실패 잡 재처리 | M1-3에서 확정 일시 거부만 자동 backoff. 최대 횟수 실패/영구 실패는 최종 상태이며 운영 재처리 도구 연결 전 SQL 재시도 금지 |
| 발송 상태·만료 위험·ETA | M1-3/M2-1. 실제 API 호출 수, 위험 집계, API 지연을 반영 |
| 공유 링크 폐기 | M2-2. 토큰 hash로 조회하고 폐기 즉시 웹/PDF 모두 거부 |
| 셀러 직접 응답 후 FAQ 중단 | M2-3. 실제 echo 확인 전 일반 공개 금지 |

## 댓글 라우터·예약 잡 확인

`comment_events`의 `campaign_pending`/`campaign_processing`은 기존 worker가 claim하지 않는다. 라우터가 campaign→specific→all 순으로 결정한다. 단순 미매칭만 기존 `pending`으로 넘기고, 제외어·중복·권한 제한은 기존 자동화로 우회하지 않는다. `campaign_routed`는 분류/잡 생성 완료이며 실제 발송 성공을 뜻하지 않는다. 발송 결과의 원장은 `dm_jobs`다.

Meta 댓글 timestamp 조회 실패는 지수 backoff로 최대 설정 횟수까지 재시도한 뒤 `campaign_failed`와 정제한 오류 코드를 남긴다. 댓글 수신 시각으로 deadline을 추정하지 않는다. 토큰 만료이면 계정을 `reauth_required`로 바꾸고 댓글을 보관하며, 재인증 후 재개한다. 플래그 OFF도 기존 캠페인 이벤트를 보류하고 legacy로 넘기지 않는다.

`CAMPAIGN_ROUTER_CONCURRENCY`의 기본은 32이며 메타데이터 네트워크 호출 중 DB transaction을 점유하지 않는다. 재시작으로 중단된 라우터는 60초 lease 만료 후 다른 worker가 가져간다. 이전 worker의 늦은 metadata 결과는 attempt fence로 거부한다. M1-4d의 sender가 플래그 ON 계정의 `dm_jobs`를 claim하고 실제 송신한다.

```sql
SELECT status, count(*) FROM comment_events
WHERE route_owner <> 'legacy' GROUP BY status;
SELECT campaign_id, channel, status, count(*) FROM dm_jobs
GROUP BY campaign_id, channel, status;
SELECT error_code, count(*) FROM comment_events
WHERE status = 'campaign_failed' GROUP BY error_code;
```

`0003_gonggu_routing.sql`의 down은 캠페인 수신 이력/참가자/잡/비공개 답장 권리가 있으면 거부한다. 라우팅에 참여했던 legacy fallback 이벤트도 `flag_checked_at`으로 식별해 보존한다. 이미 캠페인 이벤트가 들어온 환경에서는 flag OFF와 호환 worker 롤백을 사용한다. 기존 pending으로 일괄 UPDATE하면 중복/즉시 발송 위험이 있으므로 하지 않는다.

## 검증과 250계정 수용량

재현 명령은 [M1-1 검증 결과](evidence/m1-1.md), [M1-2 검증 결과](evidence/m1-2.md), [M1-3 검증 결과](evidence/m1-3.md)에 기록한다. 테스트 DB는 기존 통합 테스트에서 스키마를 초기화하므로 운영 연결 문자열을 사용하지 않는다. 250개 계정의 상태 전환/잡 생성 시험은 발송 throughput 시험과 구별한다. 실제 API 요청 없이 PostgreSQL만 측정한 결과를 전체 서비스 수용량 보장으로 해석하지 않는다.

## 메시지 수신·팔로우 응답

`message_events`는 서명 검증 뒤 사용하는 영속 수신함이다. M1-4d부터 guarded 계정의 webhook은 저장 후 응답하고 worker가 처리한다. `user_message_evidence`가 있는 Meta 작성 시각만 동의/대화 창의 근거가 되며 postback은 그 자체로 창을 열지 않는다. 여러 캠페인/기존 gate가 모호하면 `ambiguous_follow_context`로 남기고 임의로 링크를 보내지 않는다.

`profile_field_missing`은 비팔로워 확정이 아니다. 권한/필드/토큰을 확인하고, 이를 fail-open 대상이나 성공으로 일괄 변경하지 않는다. `profile_fail_open:*`는 동의 후 일시 장애에 대한 셀러 설정 적용이다. 모든 일반 DM은 원래 source의 deadline도 검사하므로 새 메시지가 왔다고 옛 잡의 시각을 SQL로 연장하지 않는다. 실제 새 팔로우 확인 응답은 **발송 시도 0회인 만료/취소 잡**만 새 잡으로 대체할 수 있고 원래 만료 이력은 보존된다. unknown/이미 시도한 잡은 대체하지 않는다.

```sql
SELECT status, last_error_code, count(*) FROM message_events GROUP BY status, last_error_code;
SELECT kind, status, count(*) FROM dm_jobs WHERE channel = 'message' GROUP BY kind, status;
```

`0007` down은 수신/조회 이력이 있으면 거부한다. 메시지 원문/peer ID를 브랜드 리포트나 공개 응답에 내보내지 않는다. 계정 삭제 callback의 기존 계정 삭제 transaction에 연결된 FK cascade로 수신함/동의 상태도 제거된다.


## 발송 일시정지·속도·확인 필요 (M1-3)

공구 상세의 **발송 현황 → 이 인스타 계정의 발송 설정**에서 전체 정지, private reply 시간당 cap, 공개 답글 보호 중 DM 유지 여부를 저장한다. 계정 cap과 캠페인 cap 중 낮은 값이 적용된다. 재개는 전체 정지를 해제하고 저장한다. 수동 정지는 시간 경과로 해제되지 않는다. 이미 허가받아 전송 중인 호출은 완료될 수 있다.

정책 차단은 원인을 해결한 뒤 별도 확인 체크를 저장해야 한다. 재개/확인 체크는 최근 호출 원장·남은 cooldown·토큰을 초기화하지 않는다. 변경은 `account_send_audit_events`에 요청 ID와 함께 기록되고, 다른 셀러의 계정이나 오래된 version은 거부된다.

새 발송 예산을 만드는 계정에 최근 legacy 발송 예약/진행 중 작업이 있으면 최대 한 시간과 permit 여유만큼 warmup한다. 기존 팔로우 후속 발송은 `last_untracked_send_at`도 검사하며, 과거 checks만 있고 호출 시각을 모르는 경우도 보수적으로 warmup한다. 실시간 발송 중 account cap을 낮추어도 지난 호출 수는 남으므로 다음 허용 시각까지 기다린다.

`send_attempts`는 API 호출 전에 저장된다. 허가 수명 기본 2초, lease 기본 60초이며 정책 테이블로 관리한다. 호출 전에 허가가 만료되면 `not_invoked`로 남기고 재예약한다. API 호출 시작 이후 응답 유실/서버 오류/worker 유실은 `unknown`; 화면에는 **확인 필요**로 표시하며 자동 재발송하지 않는다. 늦게 도착한 성공 응답도 이미 확정된 잡을 덮지 않고 `late_result`에 보관한다.

```sql
SELECT campaign_id, id AS job_id, channel, kind, status, attempts, last_error_code
FROM dm_jobs WHERE status IN ('unknown', 'failed', 'expired') ORDER BY updated_at DESC LIMIT 100;
SELECT job_id, state, error_code, provider_message_id, late_result
FROM send_attempts WHERE state = 'unknown' ORDER BY started_at DESC LIMIT 100;
SELECT ig_account_id, channel, error_streak, paused_until, requires_review
FROM send_buckets WHERE paused_until IS NOT NULL OR requires_review;
SELECT ig_account_id, status, attempts, next_attempt_at
FROM campaign_notification_outbox WHERE status <> 'sent';
```

확정된 rate 거부는 기존 30초 기반 backoff·지터를 재사용한다. Retry-After/usage header가 더 길면 그 이후로 미룬다. `unknown`, private reply 권리 소비, 영구 오류를 `waiting`으로 UPDATE하지 않는다. 오류 원인을 해결해도 동일 댓글 재전송 가능 여부는 달라지지 않는다. 확실히 호출되지 않은 lease만 자동 회수한다.

자동 보호 알림은 발송 결과와 같은 transaction에서 outbox에 저장된다. 별도 scheduler가 DB lease로 선택하고 이메일 HTTP 요청 중 DB transaction을 점유하지 않는다. 공급자 미설정/실패를 성공으로 기록하지 않으며, 재시도 소진 시 화면에 이메일 실패를 표시한다. 이메일 중복 방지 키는 outbox ID로 고정한다.

`0004_gonggu_dispatch.sql` rollback은 예산/시도/대화/알림 데이터나 jitter가 적용된 잡이 있으면 거부한다. 운영 롤백은 flag OFF로 하고 원장을 보존한다. 계정 보호 상태를 삭제해 속도를 초기화하지 않는다.

## 상품 링크·클릭 확인 (M1-4a)

상품/옵션이 하나면 `/r/{code}`로 구매처에 302 이동하고, 여러 개면 `/c/{code}`에서 선택한다. URL은 메시지 발송 준비 시점에 고정된다. 상품 주소를 수정하면 아직 보내지 않은 잡에서 새 코드를 사용하며 이미 전달된 링크는 그대로 열린다. 플래그 OFF도 기존 발송 링크를 닫지 않는다.

공구 상세의 클릭 현황은 30초마다 갱신한다. 고유 클릭은 수신자 HMAC 기준이며 링크를 전달받은 다른 사람도 원 수신자에게 귀속된다. Meta 미리보기·HEAD·prefetch는 집계하지 않는다. 집계 SQL에는 원본 IGSID/username/IP가 필요하지 않다.

```sql
SELECT campaign_id, count(*) AS total_clicks, count(DISTINCT recipient_hash) AS unique_clicks
FROM campaign_click_events GROUP BY campaign_id;
SELECT campaign_id, product_id, sum(click_count) AS total_clicks
FROM campaign_tracked_links GROUP BY campaign_id, product_id;
```

`0005` down은 링크/catalog/클릭 데이터가 있으면 거부한다. 기능 롤백 때 이 데이터를 DROP하거나 URL을 덮어쓰지 않는다. 브라우저 검증 근거는 [M1-4a 결과](evidence/m1-4a.md)에 있다. 실제 Meta 팔로우 버튼 동작은 후속 검증 대상이다.

## 기존 자동화 공통 예산과 확인 필요 (M1-4b)

한번도 활성화하지 않은 계정은 기존 경로 그대로다. 활성화한 계정의 공개 답글과 댓글 DM은 공구와 같은 PG 예산/원장을 사용한다. 플래그 OFF 직후에도 **마지막 공통 발송+한 시간+permit 여유**가 지날 때까지 같은 제한을 유지한다. 계속 발송하면 이 구간도 연장되므로 OFF만으로 구 속도나 새 한도가 즉시 생기지 않는다. 최근 발송 원장을 지우거나 구 worker를 같이 실행하지 않는다.

발송이 한 시간 이상 없어 구 경로로 돌아간 뒤 ON하면 그 사이 구 경로의 호출을 검사한다. 최근 사용량을 확정할 수 없으면 한 시간 warmup을 다시 거친다. 캠페인 sender가 먼저 실행되거나 전환이 permit 직전에 겹치는 경우도 같은 보호를 적용한다.

기존 자동화의 `send_unknown`은 화면에 **발송 확인 필요**로 보인다. 실패/대기/보냄 통계에 섞지 않으며 사람 중복 예약과 usage는 유지한다. 수락 기록은 `send_attempts.legacy_event_id`로 찾는다. `sending`/`unknown`을 pending으로 바꾸거나 발송 기록을 삭제해 재전송하지 않는다. 늦은 성공은 `late_result`의 근거로만 검토한다.

`0006` down은 guarded jitter, 발송 확인 필요, legacy 발송 원장 또는 OFF 관측 이력이 있으면 거부한다. 사용 중인 source lease를 안전하게 종료한 뒤 호환 코드로 롤백하며, 운영 데이터를 보유한 상태에서 컬럼을 DROP하지 않는다. [검증 결과](evidence/m1-4b.md)

## 공구 송신 루프와 기존 팔로우 후속 처리 (M1-4d)

`CAMPAIGN_SENDER_CONCURRENCY=64`, `CAMPAIGN_INBOX_CONCURRENCY=8`이 기본이다. sender는 250ms polling과 `campaign_jobs` NOTIFY, inbox는 500ms polling과 `gonggu_message_events` NOTIFY를 함께 사용한다. NOTIFY가 없어도 polling으로 재개한다. PG 연결 수는 기존 `WORKER_CONCURRENCY + 4`를 유지하고 HTTP 동시성에 맞춰 늘리지 않는다.

웹/워커의 구 버전을 drain한 다음 호환 버전으로 전환한다. 구 프로세스가 새 버킷 밖에서 같은 계정에 송신하는 혼합 배포는 지원하지 않는다. flag OFF 시 새 캠페인 발송은 멈추고 기존 guarded 팔로우 응답은 안전 구간/미완료 gate를 따라 공유 예산 안에서 처리한다. OFF 직후 DB 원장을 지우거나 스키마를 내리지 않는다.

공구 상세와 기존 자동화 상세의 **팔로우 확인 답장 처리**에서 대기·처리 실패·확인 필요·창 만료를 확인한다. `profile_field_missing`, 권한/토큰 실패는 실제 조회 결과를 확인한다. 기존 자동화는 조회 일시 장애도 hold하므로 캠페인의 fail-open 기본과 다르다.

`legacy_follow_history_unverified`는 원장 도입 전 tap 이력의 성공 여부를 확정할 수 없다는 뜻이다. 단순 waiting으로 재설정하지 않는다. 원래 private reply가 unknown인 경우도 사용자 답장만으로 성공 처리하지 않는다. 읽기 중 중단은 자동 재개되지만 일반 DM 준비 후 중단은 `worker_lost_after_prepare`/확인 필요로 남는다. 늦은 응답은 `send_attempts.late_result`를 보고 판단하며 자동 재발송하지 않는다.

```sql
SELECT ig_account_id, status, last_error_code, count(*)
FROM message_events GROUP BY ig_account_id, status, last_error_code;
SELECT legacy_event_id, source_message_event_id, logical_key, state, error_code, late_result
FROM send_attempts WHERE channel = 'message' AND legacy_event_id IS NOT NULL
ORDER BY started_at DESC LIMIT 100;
```

`0008` down은 source 연결, unknown, jitter/format 또는 과거 송신 marker가 남아 있으면 거부한다. 관련 근거를 삭제해 down을 통과시키지 않는다. 실제 Meta 테스트 계정으로 private reply·동의·팔로우·IGSID 일치와 echo를 확인하기 전에는 일반 공개하지 않는다.

## 성과 리포트·수동 주문 수정·공유 폐기

공구 상세 → 성과 리포트에서 실시간 집계와 저장한 버전을 확인한다. 수동 주문 수/매출은 누적값이다. 최신 revision으로 저장하며 다른 창에서 변경했으면 새로고침한다. 정산 뒤 수정은 명시 확인하고 새 버전을 만든다. 과거 버전과 이미 공유한 숫자는 바뀌지 않는다. 대기/확인 필요가 있으면 정산 전에 확인하고 미확정 숫자가 포함된 보고서임을 표시한다.

CLOSED/SOLD_OUT/SETTLED 전환 때 `report_requests`가 생성되고 30초 주기 worker가 처리한다. 5회 실패는 화면에 표시된다. SQL로 snapshot 수치를 덮어쓰지 말고 실시간 데이터를 확인한 뒤 새 버전을 저장한다.

저장 버전에서 **브랜드에 공유하기**를 연다. 제목/브랜드/상품명의 개인정보 검토 확인, 만료 기간, PDF 허용 여부를 선택한 다음 발급한다. 링크는 생성 직후에만 복사할 수 있다. 주소를 잃으면 기존 공유를 폐기하고 새 링크를 만든다. DB token hash로 원래 URL을 복구할 수 없다.

**설정 → 공유 리포트 관리 → 공유 폐기**는 플래그 OFF·계정 연결 해제·요금제 변경 뒤에도 가능하다. 이후 익명 웹/PDF 요청은 모두 404이고 캐시가 접근을 복원하지 않는다. 이미 받은 PDF는 회수되지 않는다. 발급된 링크는 폐기/만료/데이터 삭제 전까지 유지된다. 공유 페이지 전체 URL은 접근 권한이므로 운영 로그/문의에 붙이지 말고 내부 share ID로 조사한다.

PDF 429는 생성 동시성 제한이므로 Retry-After 뒤 다시 요청한다. 503이 지속되면 standalone의 `src/assets/fonts/nanumgothic/NanumGothic-Regular.ttf`와 PDFKit 패키지가 포함됐는지 확인한다. 외부 URL에서 즉석으로 폰트를 다운로드하는 방식으로 우회하지 않는다. PDF와 웹은 반드시 같은 snapshot/revision을 비교한다.

리포트 경유 가입은 같은 브라우저의 첫 유효 방문부터 30일 안에 생성된 신규 계정만 센다. 기존 회원·다른 기기·cookie 삭제는 집계되지 않는다. 직접 내려받은 PDF 경유와 공유 링크별 신규 가입을 소유자 화면에서 구분하고, 가입자 식별자는 브랜드 화면에 노출하지 않는다. `0010` down은 공유 또는 snapshot 이력이 있으면 거부하므로 flag OFF로 호환 롤백한다.

## FAQ 사전 설정·대화 일시정지

공구 상세 → **공구 FAQ·대화 관리**에서 키워드와 답변을 설정한다. 공구 Pro entitlement가 필요하며, 답변은 자동 안내 표시를 포함해 1,000바이트 안으로 작성한다. 우선순위는 작은 숫자부터다. 규칙을 끄면 아직 호출하지 않은 해당 FAQ를 취소하고, 수정하면 다음 발송에 최신 답변이 적용된다.

FAQ는 **계정별 직접 답변 감지 검증 전 발송 금지**다. `gonggu_campaigns`만 켜도 FAQ는 열리지 않는다. 실계정 두 개로 사용자 문의, Instagram 앱의 셀러 직접 답변 echo, 링포 메시지 echo, 지연·중복 payload, 계정 IGSID 일치를 확인한 후 운영자가 `gonggu_faq_handoff_verified` 전체 플래그와 해당 계정 override를 함께 켠다. 신규 OAuth 권한 없이 가능하다는 문서 근거와 실제 webhook 필드 구독/전달 확인은 별개다. `default_enabled=true`로 이 검증을 우회하지 않는다.

대화 목록에서 직접 일시정지하거나 새 문의 응답을 재개할 수 있다. 기본 1시간이며 `campaign_policies.faq_handoff_seconds`를 따른다. 이전에 셀러가 답한 문의를 재개 버튼으로 다시 보내지 않는다. 소유자 화면은 문의 일부/최근 시각으로 대화를 구분하고 50개씩 이전 페이지를 볼 수 있다. 브랜드 공유에는 문의 내용이 포함되지 않는다.

`echo_pending`은 송신의 주체를 확인 중인 상태다. `ringpo_echo`는 링포가 보낸 것으로 확인했고 `human_handoff`는 셀러 또는 다른 도구가 응답한 대화다. `echo_send_pending`이면 원래 `send_attempts`의 쓰기 결과/lease를 먼저 확인한다. pending 표식을 SQL로 지워 발송을 강제하지 않는다. `faq_response_pending`은 이전 FAQ가 미완료 또는 확인 필요인 상태이므로 그 원장부터 조사한다. 기존 unknown을 재시도로 바꾸지 않는다. 실계정 echo 동작이 어긋나면 계정 override를 끄고 새 FAQ 발송을 멈춘다.
