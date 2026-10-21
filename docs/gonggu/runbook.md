# 공구 캠페인 운영 절차

작성일: 2026-10-21. 구현 단계: **M1-1 기반 기능**. 운영 배포 전이며 이 단계에는 댓글 라우터·DM dispatch·리포트가 아직 포함되지 않는다. 이후 PR에서 해당 절차와 실제 명령을 추가한다.

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
2. 초안은 `공개 및 오픈 예약`으로 공개한다. Pro의 `예고 시작`은 예약 알림을 받을 단계를 활성화한다. 이 기반 PR에서는 아직 댓글을 처리하지 않는다.
3. 공개 예약/예고 상태에서는 `지금 오픈`, 진행 상태에서는 `마감` 또는 `품절 처리`를 누른다. 마감/품절 후에는 `정산 확정`이 가능하다. 확정 리포트는 M2에서 연결한다.
4. `연결 해제 및 보관`은 목록에서 숨기고 다른 캠페인에서 게시물을 사용할 수 있게 한다. 기록은 보존한다.
5. 운영 이력에서 실행 시각, 실행 주체, 상태 변경을 확인한다. 예약의 효력 시각은 `campaign_audit_events.effective_at`, 실제 처리 시각은 `created_at` 및 캠페인의 실제 전환 시각이다.

다른 창에서 수정했다면 새로고침 후 다시 실행한다. 직접 SQL로 status만 바꾸면 version·감사·예약 불변식을 깨므로 사용하지 않는다. 역방향 재오픈은 허용하지 않는다. 종료 캠페인의 미디어는 명시적으로 연결을 해제하기 전까지 그 캠페인에 남는다.

## 권한 설정

`plan_entitlements`가 공구 권한의 원천이다. `campaign.max_active`는 `kind=limit`; NULL은 무제한이다. Boolean 기능은 `kind=boolean, boolean_value=true/false`로 관리한다. 기본 Free 활성 1개/기본 클릭, Pro 활성 무제한/전체 기능이다. 발송량은 새 캠페인 quota로 사용하지 않는다. 기존 게시물 자동화의 플랜 동작은 그대로 유지한다.

활성 수는 셀러의 모든 IG 계정에 걸쳐 공개 예약 DRAFT/TEASER/OPEN을 합산한다. 동시 공개 요청도 같은 셀러 잠금으로 직렬화한다. 정책 수치는 `campaign_policies`에서 관리하며, 누락된 필수 설정은 추정값으로 대체하지 않고 작업을 거부한다.

## 후속 PR에서 제공할 운영 기능

| 절차 | 현재 상태·필수 정책 |
| --- | --- |
| 계정 전체 일시정지/재개·자동 breaker | M1-3. 수동 정지는 자동 해제하지 않으며 채널별 중단과 감사 로그 필요 |
| 실패 잡 재처리 | M1-3. 확정 실패 중 재시도 가능한 오류만. 결과 `unknown`은 자동/무조건 재발송 금지 |
| 발송 상태·만료 위험·ETA | M1-3/M2-1. 실제 API 호출 수, 위험 집계, API 지연을 반영 |
| 공유 링크 폐기 | M2-2. 토큰 hash로 조회하고 폐기 즉시 웹/PDF 모두 거부 |
| 셀러 직접 응답 후 FAQ 중단 | M2-3. 실제 echo 확인 전 일반 공개 금지 |

## 검증과 250계정 수용량

재현 명령은 [M1-1 검증 결과](evidence/m1-1.md)에 기록한다. 테스트 DB는 기존 통합 테스트에서 스키마를 초기화하므로 운영 연결 문자열을 사용하지 않는다. 250개 계정의 상태 전환 시험은 발송 throughput 시험과 구별한다. 실제 API 요청 없이 PostgreSQL만 측정한 결과를 전체 서비스 수용량 보장으로 해석하지 않는다.
