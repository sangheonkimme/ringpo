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

  return <main className="px-5 py-24 text-center text-sm text-muted-foreground">{message}</main>;
}

export default function BillingCompletePage() {
  return (
    <Suspense>
      <Complete />
    </Suspense>
  );
}
