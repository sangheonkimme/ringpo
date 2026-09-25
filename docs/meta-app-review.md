# Meta 앱 검수 제출 키트 (Instagram API with Instagram Login)

목표: 아래 세 권한의 **고급 액세스(Advanced Access)**. 받으면 테스터가 아닌 일반 고객도 인스타를 연결할 수 있어요.

| 권한 | 링포에서 쓰는 곳 | 성공한 API 호출 |
|---|---|---|
| `instagram_business_basic` | 연결한 계정 정보, 게시물 목록(자동화 대상 선택) | ✓ 2026-09-25 |
| `instagram_business_manage_comments` | 댓글 알림 받기, 공개 답글 달기 | ✓ 2026-09-25 |
| `instagram_business_manage_messages` | 댓글 단 사람에게 DM(비공개 답장), 팔로우 확인 | ✓ 2026-09-25 |

그 밖의 권한은 요청하지 마세요. 쓰지 않는 권한을 요청하면 거절돼요.

## 1. 제출 전 체크리스트

- [ ] 앱 게시(라이브) 상태 ✓ (완료)
- [ ] 앱 설정 → 기본 설정: 아이콘, 개인정보처리방침, 약관, 데이터 삭제 콜백, 카테고리 ✓ (완료)
- [x] 연락 이메일: `railit.biz@gmail.com` ✓ (완료)
- [x] 사업자 정보: 레일릿 · 491-12-02435 ✓ (완료)
- [ ] 통신판매업 신고번호·대표 전화: 유료 결제 열기 전에 채우기 (검수에는 필요 없음)
- [ ] 구글 로그인 켜기: Google Cloud에서 OAuth 클라이언트를 만들고 `deploy/.env`에 키 넣기 (검수자가 자기 구글 계정으로 로그인)
- [ ] 비즈니스 인증: 제출 화면에서 요구하면 진행 (사업자등록증 필요)
- [ ] 시연 영상 녹화 (아래 3번) — 1080p 이상, 브라우저 폭 1440px 이하

## 2. 권한별 사용 설명 (영어, 그대로 붙여넣기)

### instagram_business_basic

> Ringpo is a tool for Instagram creators and small businesses that automatically replies to comments on their own posts and sends the commenter a DM with a link.
>
> We use instagram_business_basic to (1) identify the Instagram professional account the user connects (username, profile picture, account type) and show it in the dashboard, and (2) list the connected account's own posts and reels so the user can choose which post an automation applies to. We only read the connected user's own profile and media. We do not access or store content from other accounts.

### instagram_business_manage_comments

> The account owner creates an automation with keywords (for example "link"). When someone comments on the owner's post, Ringpo receives the comment through the comments webhook, checks whether it contains the owner's keyword, and posts a public reply to that comment on the owner's behalf (for example "@user Check your DM!"). The owner writes these reply texts. We read the comment text and username only to match keywords and to show the owner a send history. We never reply to comments on media the owner does not own, and we never reply to the owner's own comments.

### instagram_business_manage_messages

> For each matching comment, Ringpo sends one private reply (Instagram's private replies feature) to the commenter. It contains the message and link button that the account owner wrote, for example a product or event link the commenter asked for. Only one DM is sent per comment, only within 7 days of the comment, and only once per person per post.
>
> Optionally, the owner can turn on "send the link to followers only". Then the private reply contains an "I followed" button. When the commenter taps it, we check is_user_follow_business for that person and, within the 24-hour messaging window that their tap opened, send the link DM (or a reminder to follow). We never send unsolicited messages to people who did not comment on the owner's post.

## 3. 시연 영상 대본 (영상 1개를 세 권한에 같이 올려도 돼요)

앱 화면이 한국어라 **장면마다 영어 자막**을 넣어야 해요. 아래 "Caption"을 화면 위나 아래에 그대로 넣으세요. 버튼을 누를 땐 그 버튼 이름의 영어 뜻도 같이 적어요.

| # | 화면 | 할 일 | Caption (영어 자막) |
|---|---|---|---|
| 1 | 링포 랜딩 (로그아웃 상태) | 오른쪽 위 "무료로 시작" | Ringpo — automatic replies and DMs for comments on your own Instagram posts. The UI is in Korean; captions explain each step. Tapping "Start free". |
| 2 | 로그인 | "Google로 시작하기"로 로그인 | Logging in with Google ("Google로 시작하기" = "Continue with Google"). |
| 3 | 시작하기 | "인스타그램으로 연결하기" | Step 1: "Connect Instagram". This opens the official Instagram Business Login. |
| 4 | 인스타 로그인·동의 화면 | 권한 3개가 보이게 잠깐 멈춤 → "허용" | The user grants instagram_business_basic, instagram_business_manage_comments and instagram_business_manage_messages. |
| 5 | 링포로 돌아옴 | "@계정 · 연결됨" 보이기 | instagram_business_basic: we show the connected account's username and profile. |
| 6 | 자동화 만들기 1단계 | 게시물 목록에서 하나 고르기 | instagram_business_basic: listing the account's own posts so the user picks which post the automation applies to. |
| 7 | 2단계 키워드 | "link" 같은 키워드 입력 | The automation reacts to comments containing this keyword. |
| 8 | 3단계 공개 답글 | 답글 문구 보여 주기 | instagram_business_manage_comments: this public reply will be posted under the matching comment. |
| 9 | 4단계 DM | DM 내용, 버튼 문구, 링크 입력 (팔로우 확인 토글도 켜서 보여 주기) | instagram_business_manage_messages: this DM (with a link button) is sent to the commenter as a private reply. Optional: send the link only after the commenter follows. |
| 10 | 5단계 확인 → "켜고 저장" | 저장 | "Turn on and save". The automation is now running. |
| 11 | 휴대폰(다른 계정)으로 게시물 댓글 | 키워드 댓글 달기 | Another Instagram user comments the keyword on the owner's post. |
| 12 | 게시물 댓글 | 공개 답글이 달린 것 보여 주기 | instagram_business_manage_comments: Ringpo replied to the comment publicly. |
| 13 | 댓글 단 사람의 DM (앱) | DM + 버튼 보여 주기, (팔로우 확인이면) "팔로우했어요" 탭 → 링크 DM | instagram_business_manage_messages: the commenter received one private reply. With the follow option, tapping "I followed" lets us check is_user_follow_business, then the link is sent. |
| 14 | 링포 자동화 상세 | 통계·발송 기록 보여 주기 | The owner sees the send history: comment, reply status and DM status. |
| 15 | 설정 → 계정 연결 해제 | 해제 버튼까지만 보여 주기 | The user can disconnect the Instagram account at any time. Data deletion requests are handled via our data deletion callback. |

녹화 팁
- 데스크톱 브라우저(폭 1440px 이하)와 휴대폰 화면을 번갈아 찍어 한 영상으로 이어 붙이면 돼요.
- 동의 화면(4번)과 DM이 도착한 화면(13번)은 2~3초씩 멈춰서 또렷하게 보여 주세요.
- 개인 정보(다른 사람 이름, 전화번호)가 보이면 가리세요.

## 4. 검수자 안내 (영어, "검수 방법" 칸에 붙여넣기)

> **How to test**
> 1. Go to https://ringpo.srv1861800.hstgr.cloud/login and tap "Google로 시작하기" (Continue with Google). Any Google account works; a Ringpo account is created on first login.
> 2. On the "Get started" screen, tap "인스타그램으로 연결하기" (Connect Instagram) and authorize with an Instagram professional account.
> 3. Tap "자동화 만들기" (Create automation). Pick a post, enter a keyword (e.g. "link"), keep the default public reply texts, enter a DM text and an https link, then tap "켜고 저장" (Turn on and save).
> 4. From another Instagram account, comment the keyword on that post. Within seconds Ringpo posts a public reply and sends one DM with the link button to the commenter.
> 5. The automation page shows the send history.
>
> The app UI is Korean. The screencast has English captions for every step.
>
> **Test account**: Not needed. Log in with any Google account. Connecting Instagram requires an Instagram professional (Business or Creator) account; Instagram offers to switch a personal account during the connect flow.

## 5. 자주 거절되는 이유 (피하기)

- 영상에 권한 하나라도 쓰는 장면이 빠짐 → 3번 표의 권한 자막 장면을 빠뜨리지 마세요.
- 로그인 과정이 안 보임 → 1~5번 장면을 꼭 넣어요.
- 영어 설명이 없음 → 모든 장면에 자막.
- 설명과 실제 사용이 다름 → 2번 설명은 실제 기능과 맞춰 썼어요. 기능을 바꾸면 설명도 고쳐요.
- 검수자가 로그인할 수 없음 → 구글 로그인을 켜고, Google Cloud 앱을 "프로덕션"으로 게시해 두기 (테스트 모드면 등록한 사람만 로그인돼요).
