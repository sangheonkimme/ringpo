"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CampaignError } from "@/server/campaigns/access";
import { createReportSnapshot, saveManualOrders } from "@/server/campaigns/report-operations";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";

export async function saveReportOrders(raw: unknown) {
  const user = await requireUser();
  try { await saveManualOrders(getDb(), user.id, raw); revalidatePath("/app/campaigns", "layout"); return { ok: true } as const; }
  catch (error) { return { ok: false, error: error instanceof CampaignError ? error.message : "주문 수치를 저장하지 못했어요" } as const; }
}
export async function freezeReport(raw: unknown) {
  const user = await requireUser(); const input = z.object({ campaignId: z.uuid(), requestId: z.uuid(), acknowledgeIncomplete: z.boolean() }).safeParse(raw);
  if (!input.success) return { ok: false, error: "리포트 요청을 확인해주세요" } as const;
  try { const snapshot = await createReportSnapshot(getDb(), user.id, input.data.campaignId, input.data); revalidatePath("/app/campaigns", "layout"); return { ok: true, snapshotId: snapshot.id } as const; }
  catch (error) { return { ok: false, error: error instanceof CampaignError ? error.message : "리포트를 저장하지 못했어요" } as const; }
}
