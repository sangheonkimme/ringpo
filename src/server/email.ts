import { Resend } from "resend";
import { getEnv } from "@/server/env";
import { log } from "@/server/log";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const env = getEnv();
  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV === "production") {
      log.error("email not sent: RESEND_API_KEY missing", { subject: msg.subject });
      return;
    }
    log.info("dev email (not sent)", { subject: msg.subject, text: msg.text });
    return;
  }
  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
  if (error) throw new Error(`resend: ${error.message}`);
}
