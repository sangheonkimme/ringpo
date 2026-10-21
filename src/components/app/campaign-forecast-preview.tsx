"use client";

import { useEffect, useMemo, useState } from "react";
import { campaignEditedTime } from "@/lib/campaign-schema";
import { CampaignForecastPanel, type CampaignForecast } from "./campaign-forecast-panel";

export function CampaignForecastPreview({ accountId, campaignId, openAt, closeAt, originalOpenAt, originalCloseAt, hourlyRate, expiryFallback }: { accountId: string; campaignId?: string; openAt: string; closeAt: string; originalOpenAt?: string; originalCloseAt?: string; hourlyRate: number; expiryFallback: boolean }) {
  const url = useMemo(() => {
    try {
      if (!accountId || !Number.isInteger(hourlyRate) || hourlyRate <= 0) return null;
      const params = new URLSearchParams({ accountId, openAt: campaignEditedTime(openAt, originalOpenAt), closeAt: campaignEditedTime(closeAt, originalCloseAt), hourlyRate: String(hourlyRate), expiryFallback: String(expiryFallback) });
      if (campaignId) params.set("campaignId", campaignId);
      return `/api/campaigns/forecast?${params}`;
    } catch { return null; }
  }, [accountId, campaignId, openAt, closeAt, originalOpenAt, originalCloseAt, hourlyRate, expiryFallback]);
  const [result, setResult] = useState<{ url: string; forecast?: CampaignForecast; error?: string } | null>(null);
  useEffect(() => {
    if (!url) return;
    const abort = new AbortController(); let busy = false;
    const load = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal: abort.signal });
        const data = await response.json();
        if (!abort.signal.aborted) setResult(response.ok ? { url, forecast: data } : { url, error: data.error ?? "발송 예측을 불러오지 못했어요" });
      } catch { if (!abort.signal.aborted) setResult({ url, error: "발송 예측을 불러오지 못했어요. 잠시 후 다시 확인해주세요." }); }
      finally { busy = false; }
    };
    const delay = setTimeout(() => void load(), 350); const timer = setInterval(() => void load(), 30_000);
    return () => { abort.abort(); clearTimeout(delay); clearInterval(timer); };
  }, [url]);
  if (!url) return <p className="text-sm text-muted-foreground">일정과 발송 속도를 입력하면 만료 위험을 확인할 수 있어요.</p>;
  if (result?.url !== url) return <p role="status" className="text-sm text-muted-foreground">발송 예측 확인 중…</p>;
  if (result.error) return <p role="status" className="text-sm text-danger-ink">{result.error}</p>;
  return result.forecast ? <CampaignForecastPanel forecast={result.forecast} preview /> : null;
}
