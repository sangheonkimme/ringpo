"use server";

import { revalidatePath } from "next/cache";
import { CampaignError } from "@/server/campaigns/access";
import { createReportShare, revokeReportShare } from "@/server/campaigns/report-shares";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { requireUser } from "@/server/session";

export async function issueReportShare(raw: unknown) {
  const user = await requireUser();
  try {
    const issued = await createReportShare(getDb(), user.id, raw);
    revalidatePath("/app/report-shares"); revalidatePath("/app/campaigns", "layout");
    return { ok: true, url: new URL(`/reports/${issued.token}`, getEnv().APP_URL).toString() } as const;
  } catch (error) { return { ok: false, error: error instanceof CampaignError ? error.message : "공유 링크를 만들지 못했어요" } as const; }
}
export async function removeReportShare(id: string) {
  const user = await requireUser();
  try { await revokeReportShare(getDb(), user.id, id); revalidatePath("/app/report-shares"); revalidatePath("/app/campaigns", "layout"); return { ok: true } as const; }
  catch (error) { return { ok: false, error: error instanceof CampaignError ? error.message : "공유 링크를 폐기하지 못했어요" } as const; }
}
