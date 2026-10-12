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
