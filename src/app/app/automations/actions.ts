"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { deleteAutomation, setAutomationActive, type ToggleResult } from "@/server/automations/service";
import { getDb } from "@/server/db/client";
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
