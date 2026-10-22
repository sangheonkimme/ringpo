"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CampaignError } from "@/server/campaigns/access";
import { archiveCampaign, getCampaign, publishCampaign, saveCampaign, transitionCampaign } from "@/server/campaigns/service";
import { retryCampaignJob } from "@/server/campaigns/retry";
import { updateSendControls } from "@/server/campaigns/send-controls";
import { decryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { getGraphClient } from "@/server/instagram/client";
import { log, errorFields } from "@/server/log";
import { requireUser } from "@/server/session";

export type CampaignActionResult = { ok: true; id: string } | { ok: false; error: string };

function failure(error: unknown): CampaignActionResult {
  if (error instanceof CampaignError) return { ok: false, error: error.message };
  log.error("campaign action failed", errorFields(error));
  return { ok: false, error: "처리하지 못했어요. 잠시 후 다시 시도해주세요." };
}

export async function saveCampaignAction(raw: unknown, options: { id?: string; expectedVersion?: number }): Promise<CampaignActionResult> {
  const user = await requireUser();
  const parsed = z.object({ id: z.uuid().optional(), expectedVersion: z.number().int().positive().optional() }).safeParse(options);
  if (!parsed.success) return { ok: false, error: "공구 정보를 확인해주세요" };
  try {
    const campaign = await saveCampaign(getDb(), user.id, raw, { ...parsed.data, now: new Date(), appUrl: getEnv().APP_URL, graph: getGraphClient(), decrypt: decryptSecret });
    revalidatePath("/app/campaigns");
    revalidatePath(`/app/campaigns/${campaign.id}`);
    return { ok: true, id: campaign.id };
  } catch (error) { return failure(error); }
}

const mutationSchema = z.object({
  id: z.uuid(), version: z.number().int().positive(), requestId: z.uuid(),
  acknowledgeIncomplete: z.boolean().optional(),
  action: z.enum(["publish", "publish_teaser", "open", "closed", "sold_out", "settled", "archive"]),
});

export async function changeCampaignAction(raw: z.infer<typeof mutationSchema>): Promise<CampaignActionResult> {
  const user = await requireUser();
  const parsed = mutationSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "공구 정보를 확인해주세요" };
  const { id, version, requestId, action, acknowledgeIncomplete } = parsed.data;
  try {
    const db = getDb(); const now = new Date();
    if (action === "publish" || action === "publish_teaser") await publishCampaign(db, user.id, id, action === "publish_teaser", now);
    else if (action === "archive") await archiveCampaign(db, user.id, id, now);
    else await transitionCampaign(db, user.id, id, action, { now, expectedVersion: version, requestId, reason: "셀러 수동 전환", acknowledgeIncomplete });
    revalidatePath("/app/campaigns");
    revalidatePath(`/app/campaigns/${id}`);
    return { ok: true, id };
  } catch (error) { return failure(error); }
}

export async function saveCampaignSendSettings(id: string, raw: unknown): Promise<CampaignActionResult> {
  const user = await requireUser();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "공구 정보를 확인해주세요" };
  try {
    const db = getDb(); const campaign = await getCampaign(db, user.id, id);
    if (!campaign) throw new CampaignError("not_found", "공구를 찾을 수 없어요");
    if (!raw || typeof raw !== "object") throw new CampaignError("validation", "발송 설정을 확인해주세요");
    await updateSendControls(db, user.id, { ...raw, accountId: campaign.igAccountId }, new Date());
    revalidatePath("/app/campaigns", "layout");
    return { ok: true, id };
  } catch (error) { return failure(error); }
}

export async function retryCampaignJobAction(raw: unknown): Promise<CampaignActionResult> {
  const user = await requireUser();
  try {
    await retryCampaignJob(getDb(), user.id, raw, new Date());
    revalidatePath("/app/campaigns", "layout");
    return { ok: true, id: "" };
  } catch (error) { return failure(error); }
}
