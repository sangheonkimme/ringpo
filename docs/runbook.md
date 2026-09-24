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
- resend.com → 도메인 추가 → DNS(SPF/DKIM) 등록 → API 키 → `RESEND_API_KEY`, `EMAIL_FROM="링포 <noreply@<도메인>>"`

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
