"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { deleteUserAccount, disconnectAccount } from "@/server/account";
import { billingConfigured, getBillingGateway } from "@/server/billing/gateway";
import { decryptSecret } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";

export async function disconnectAccountAction(accountId: string): Promise<boolean> {
  const user = await requireUser();
  if (!z.uuid().safeParse(accountId).success) return false;
  const ok = await disconnectAccount(getDb(), user.id, accountId);
  revalidatePath("/app/settings");
  revalidatePath("/app");
  return ok;
}

export async function deleteMyAccountAction(confirm: string): Promise<{ ok: false; error: string } | never> {
  const user = await requireUser();
  if (confirm.trim() !== "탈퇴") return { ok: false, error: "'탈퇴'를 정확히 입력해주세요" };
  await deleteUserAccount(
    { db: getDb(), gateway: billingConfigured() ? getBillingGateway() : null, decrypt: decryptSecret },
    user.id,
  );
  redirect("/?deleted=1");
}
