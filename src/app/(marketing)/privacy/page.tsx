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
            <td>서버·데이터베이스 운영 (이전 항목: 위 수집 항목 전부, 이전 시점: 서비스 이용 시 네트워크 전송)</td>
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
