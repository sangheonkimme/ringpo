# 공구 캠페인 검증·출시 점검

기준일: 2026-10-22 UTC. 코드·로컬 검증은 완료했고 draft PR로 분리했다. 운영 배포·마이그레이션·실제 Meta 발송은 하지 않았다. Redis 없이 기존 PostgreSQL worker/queue를 확장한다. 자동 시험은 별도 DB와 API fixture에서 수행한다. 실제 계정 조건을 자동 시험으로 대체하지 않는다.

[최종 검증 결과](evidence/m2-5.md): 전체 회귀 524개, 250계정 실제 10분 혼합 부하 7,000건(누락·중복 0), 단일 계정 가상 시각 3,000건(rolling hour 최대 400), 추가 마이그레이션 검사 통과.

## 요구사항과 증거

| 완료 기준 | 자동 검증·화면 증거 | 실제 계정 상태 |
| --- | --- | --- |
| TEASER 공개 답글만 발송, Meta 댓글 시각 기반 7일−1시간 예약 | `campaign-routing`, `campaign-dispatch`, `campaign-runtime`; M1-2/3/4d | 테스트 계정 필요 |
| OPEN 전환 멱등, deadline 우선, rolling-hour 제한 | `campaign-service`, `campaign-foundation-load`, `campaign-dispatch-load`, `campaign-runtime-load` | API 실지연 측정 필요 |
| 만료 위험·대체 안내/만료 표시 | `campaign-routing`, `campaign-forecast`; [예상 화면](evidence/m2-1.md) | 기본 문구 최종 검토 |
| 같은 사람의 공구 DM 중복·웹훅 3회 전달 방지 | `campaign-routing`, `shared-send-budget`, `campaign-runtime-load` | 댓글/메시지 IGSID 일치 확인 필요 |
| 팔로우 응답 후 링크 | `campaign-follow-messages`, `follow-inbox`, `campaign-runtime`; 승인된 동의 우선 흐름 | profile consent, quick reply/postback payload 확인 필요 |
| 마감·품절 뒤 새 대상 마감 안내 | `campaign-routing`, `campaign-dispatch`; [상태 화면](evidence/m1-1.md) | 테스트 계정 필요 |
| 클릭 1분 이내·미리보기 제외 | `campaign-tracking`, `campaign-report`; [클릭/리포트 화면](evidence/m2-2a.md) | 실제 Instagram 미리보기 요청 확인 권장 |
| 연속 rate/정책 오류 자동 정지·메일 | `campaign-dispatch`, `shared-send-budget`, `campaign-operations`; [일시정지 화면](evidence/m1-3.md) | fixture로 검증, 실제 제한을 유발하는 시험은 하지 않음 |
| 익명 집계 공유·폐기·PDF 동일 숫자 | `report-sharing`, `unit/report-pdf`; [브랜드/PDF 화면](evidence/m2-2b.md) | 별도 Meta 권한 불필요 |
| OFF 기존 자동화 회귀 | `campaign-runtime`, `shared-send-budget`, 기존 pipeline/follow 테스트 | 아직 한 번도 ON되지 않은 계정은 기존 경로 유지 |
| Free 활성 1개·Pro entitlement | `campaign-service`, `campaign-foundation-load`, `report-sharing`, `campaign-faq` | 기존 유료 고객 승계 없음 |
| FAQ·직접 답변 자동 중단 | `campaign-faq`, `campaign-faq-migration`; [FAQ 화면](evidence/m2-3.md) | 계정별 echo 확인 플래그 기본 OFF |
| 원문 90일·삭제 callback·토큰 암호화 | `campaign-retention`, `ig-routes`, `account`, crypto; [보존 검증](evidence/m2-4.md) | 장기 운영 식별자 보존 정책 Q14 확인 |
| 확정 일시 거부만 수동 재처리·운영 지표 | `campaign-operations`, `campaign-operations-migration`; [운영 화면](evidence/m2-5.md) | unknown 수동 재발송 경로 없음 |

위 테스트 이름은 `tests/integration/`의 `.test.ts` 파일 접두사이며 일부 항목은 관련 unit 시험도 포함한다. 세부 실행 수치와 재현 범위는 각 evidence 문서가 기준이다. 로컬 테스트 통과를 GitHub CI 실행으로 표시하지 않는다.

## 실제 Meta 두 계정 점검 — 아직 미실시

게시물 소유/링포 연결 계정 A와 별도 댓글 계정 B가 지정되면 다음 순서로 확인한다. 실제 송신은 지정된 계정에서만 한다.

1. 현재 앱의 승인 권한·토큰 grant·webhook 구독을 확인한다. **새 OAuth 권한은 없음**: 기존 `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`. [공식 근거·2026-10-21/22 확인](01-design.md#2-meta-공식-문서-확인과-권한).
2. B의 알림 댓글 → A의 공개 답글만 확인 → 수동 조기 오픈 → private reply 1회, Meta 댓글 timestamp와 IGSID를 수신 로그와 대조한다. 같은 이벤트/다른 댓글에서도 중복 DM이 없는지 확인한다.
3. 동의 없는 B에게 응답 요청 → 실제 사용자 답장/quick reply → 프로필 `is_user_follow_business` 확인 → 팔로우 후 링크. URL 클릭을 메시지 창으로 간주하지 않는다. postback만으로 가능한지 검증되지 않으면 승인된 직접 답장 경로를 유지한다.
4. A가 Instagram 앱에서 직접 답변했을 때 해당 대화의 echo/자동 중지와 다른 대화의 독립성을 확인한다. 확인 전 `gonggu_faq_handoff_verified` 계정 override를 켜지 않는다. 새 구독이 필요하면 앱 설정에서 해당 계정 테스트 후 적용한다.
5. 마감/품절 응답, 실제 링크 미리보기와 수신자 클릭, 공유 리포트 웹/PDF, 폐기 결과를 확인한다. 화면 증거에서 사용자명·대화 원문·토큰은 가린다.

실제 Meta에 고의로 시간당 한도를 초과하거나 스팸 오류를 유발하지 않는다. 오류/장애/응답 유실은 fixture로 검증한다. 외부 성공 후 응답 유실은 승인대로 **확인 필요**이며 도달 완료로 집계하지 않는다.

## 배포 순서

1. 실제 계정 검증, 정책 문구/운영 식별자 보존 Q14, 백업/복구 가능 상태를 확인한다. 테스트용 DB URL이 운영 설정에 들어가지 않게 점검한다.
2. 기존 untracked sender와 새 sender가 동시에 실행되지 않도록 구 웹/워커를 drain한다. 기본 `gonggu_campaigns=OFF`, FAQ readiness OFF를 유지한다.
3. 백업 후 0002→0013 additive migration을 순서대로 실행한다. 기존 큰 테이블의 인덱스 생성 잠금/실행 시간은 운영과 비슷한 데이터에서 미리 확인한다. 이번 개발 작업은 운영 migration을 실행하지 않았다.
4. 호환 웹/워커를 함께 배포하고 strict health, worker heartbeat, DB pool, outbox, 만료/unknown 지표를 확인한다.
5. `enabled=true, default_enabled=false`와 지정 계정 override로 먼저 운영한다. FAQ는 echo 검증된 계정만 별도 허용한다. 측정 결과를 보고 계정을 점진적으로 늘린다.
6. 문제 발생 시 feature flag OFF와 계정 pause를 사용한다. OFF 이전 공통 원장/unknown을 삭제하지 않는다. 데이터가 있으면 destructive down을 강행하지 않고 호환 코드로 되돌린다. [운영 절차](runbook.md).

## PR 순서

설계 [#2](https://github.com/sangheonkimme/ringpo/pull/2) → 기반 [#3](https://github.com/sangheonkimme/ringpo/pull/3) → 라우팅 [#4](https://github.com/sangheonkimme/ringpo/pull/4) → 발송 [#5](https://github.com/sangheonkimme/ringpo/pull/5) → 추적 [#6](https://github.com/sangheonkimme/ringpo/pull/6) → 공통 예산 [#7](https://github.com/sangheonkimme/ringpo/pull/7) → 메시지 [#8](https://github.com/sangheonkimme/ringpo/pull/8) → runtime [#9](https://github.com/sangheonkimme/ringpo/pull/9) → 예상 [#10](https://github.com/sangheonkimme/ringpo/pull/10) → 리포트 [#11](https://github.com/sangheonkimme/ringpo/pull/11) → 공유/PDF [#12](https://github.com/sangheonkimme/ringpo/pull/12) → FAQ [#13](https://github.com/sangheonkimme/ringpo/pull/13) → 보존/삭제 [#14](https://github.com/sangheonkimme/ringpo/pull/14) → 운영/최종 검증 [#15](https://github.com/sangheonkimme/ringpo/pull/15).

각 PR은 앞 PR을 base로 둔다. 순서대로 리뷰/병합 후 다음 base를 갱신한다. 가격 변경과 기존 MVP의 월 DM 요금 UI 변경은 이번 승인 범위에 포함하지 않았다. 공구 작업에는 별도 월 DM quota를 추가하지 않는다.
