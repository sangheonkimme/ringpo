-- Data-preserving rollback: active send budgets/attempts must never be discarded.
BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at > 1792566589660) THEN
  RAISE EXCEPTION 'Rollback newer migrations first';
 END IF;
 IF EXISTS (SELECT 1 FROM account_send_controls) OR EXISTS (SELECT 1 FROM send_attempts)
 OR EXISTS (SELECT 1 FROM conversation_states) OR EXISTS (SELECT 1 FROM campaign_notification_outbox)
 OR EXISTS (SELECT 1 FROM campaign_rate_buckets) OR EXISTS (SELECT 1 FROM account_send_audit_events)
 OR EXISTS (SELECT 1 FROM dm_jobs WHERE jitter_until IS NOT NULL OR message_format <> 'auto') THEN
  RAISE EXCEPTION 'Campaign dispatch data exists: use flag-off rollback and retain the schema';
 END IF;
END $$;
DROP TABLE campaign_notification_outbox, conversation_states, account_send_audit_events;
DROP TABLE send_attempts, send_buckets, campaign_rate_buckets;
DROP TABLE account_send_controls;
ALTER TABLE dm_jobs DROP COLUMN jitter_until, DROP COLUMN message_format;
DELETE FROM campaign_policies WHERE key IN ('dispatch_lease_seconds', 'send_permit_ms');
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792566589660;
COMMIT;
