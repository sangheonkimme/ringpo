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
