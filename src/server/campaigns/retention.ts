import { sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { campaignPolicy } from "./access";

/** Keep the delivery/report facts, erase customer-authored content in every status, including unknown. */
export async function redactCampaignContent(db: Db, now: Date, batch = 500) {
  const [pending] = await db.execute<{ any: boolean }>(sql`select (
    exists (select 1 from comment_events where content_redacted_at is null and (flag_checked_at is not null or guarded_jitter_until is not null or campaign_id is not null))
    or exists (select 1 from message_events where content_redacted_at is null)
    or exists (select 1 from send_attempts where payload is not null)
  ) as any`);
  if (!pending?.any) return { comments: 0, messages: 0, payloads: 0 };
  const days = await campaignPolicy(db, "raw_content_retention_days");
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error("invalid_raw_content_retention_days");
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString(); const limit = Math.min(5000, Math.max(1, Math.floor(batch)));
  // Each statement is its own small transaction. No campaign/job locks are acquired in reverse order.
  const comments = await db.execute(sql`with due as (
    select id from comment_events where content_redacted_at is null and received_at <= ${cutoff}::timestamptz
      and (flag_checked_at is not null or guarded_jitter_until is not null or campaign_id is not null)
    order by received_at, id limit ${limit} for update skip locked
  ) update comment_events c set comment_text = '', commenter_username = null, error_message = null,
      campaign_rules_snapshot = null, content_redacted_at = ${now.toISOString()}::timestamptz
    from due where c.id = due.id returning c.id`);
  const messages = await db.execute(sql`with due as (
    select id from message_events where content_redacted_at is null and received_at <= ${cutoff}::timestamptz
    order by received_at, id limit ${limit} for update skip locked
  ) update message_events m set text = '', payload = null, content_redacted_at = ${now.toISOString()}::timestamptz
    from due where m.id = due.id returning m.id`);
  const payloads = await db.execute(sql`with due as (
    select id from send_attempts where payload is not null and started_at <= ${cutoff}::timestamptz
    order by started_at, id limit ${limit} for update skip locked
  ) update send_attempts a set payload = null from due where a.id = due.id returning a.id`);
  return { comments: comments.length, messages: messages.length, payloads: payloads.length };
}
