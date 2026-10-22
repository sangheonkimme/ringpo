"use server";
import { revalidatePath } from "next/cache";
import { CampaignError } from "@/server/campaigns/access";
import { saveCampaignFaq, setConversationPause } from "@/server/campaigns/faq-service";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";

export async function saveFaqAction(raw: unknown) {
  const user = await requireUser();
  try { await saveCampaignFaq(getDb(), user.id, raw); revalidatePath("/app/campaigns", "layout"); return { ok: true } as const; }
  catch (error) { return { ok: false, error: error instanceof CampaignError ? error.message : "FAQ를 저장하지 못했어요" } as const; }
}
export async function pauseConversationAction(raw: unknown) {
  const user = await requireUser();
  try { await setConversationPause(getDb(), user.id, raw); revalidatePath("/app/campaigns", "layout"); return { ok: true } as const; }
  catch (error) { return { ok: false, error: error instanceof CampaignError ? error.message : "대화 설정을 변경하지 못했어요" } as const; }
}
