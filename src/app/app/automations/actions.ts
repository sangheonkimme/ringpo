"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { automationInputSchema } from "@/lib/automation-schema";
import {
  createAutomation,
  deleteAutomation,
  setAutomationActive,
  updateAutomation,
  type SaveResult,
  type ToggleResult,
} from "@/server/automations/service";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { requireUser } from "@/server/session";

const idSchema = z.uuid();

export async function toggleAutomationAction(id: string, active: boolean): Promise<ToggleResult> {
  const user = await requireUser();
  if (!idSchema.safeParse(id).success) return { ok: false, reason: "not_found" };
  const res = await setAutomationActive(getDb(), user.id, id, active);
  revalidatePath("/app");
  revalidatePath("/app/automations");
  return res;
}

export async function deleteAutomationAction(id: string): Promise<void> {
  const user = await requireUser();
  if (idSchema.safeParse(id).success) await deleteAutomation(getDb(), user.id, id);
  revalidatePath("/app");
  redirect("/app/automations");
}

export async function saveAutomationAction(
  raw: unknown,
  opts: { id?: string; activate: boolean },
): Promise<SaveResult> {
  const user = await requireUser();
  const parsed = automationInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요" };
  const appUrl = getEnv().APP_URL;
  const res =
    opts.id && idSchema.safeParse(opts.id).success
      ? await updateAutomation(getDb(), user.id, opts.id, parsed.data, { appUrl, activate: opts.activate })
      : await createAutomation(getDb(), user.id, parsed.data, { appUrl, activate: opts.activate });
  revalidatePath("/app");
  revalidatePath("/app/automations");
  return res;
}
