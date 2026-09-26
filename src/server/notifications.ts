import { eq } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { sendEmail } from "@/server/email";
import type { EmailContent } from "@/server/emails";
import { errorFields, log } from "@/server/log";

export async function notifyUser(db: Executor, userId: string, content: EmailContent): Promise<void> {
  const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1);
  if (!row) return;
  try {
    await sendEmail({ to: row.email, ...content });
  } catch (e) {
    log.error("notification failed", { userId, ...errorFields(e) });
  }
}
