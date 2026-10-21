BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at > 1792574104231) THEN
  RAISE EXCEPTION 'Rollback newer migrations first';
 END IF;
 IF EXISTS (SELECT 1 FROM message_events WHERE legacy_event_id IS NOT NULL OR status = 'send_unknown' OR jitter_until IS NOT NULL OR message_format <> 'auto')
 OR EXISTS (SELECT 1 FROM send_attempts WHERE source_message_event_id IS NOT NULL)
 OR EXISTS (SELECT 1 FROM follow_gates WHERE last_untracked_send_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Runtime send history exists: preserve source, budget and deduplication evidence';
 END IF;
END $$;
DROP INDEX message_events_expiry_idx;
DROP INDEX message_events_campaign_status_idx;
DROP INDEX message_events_retention_idx;
DROP INDEX send_attempts_message_idx;
DROP INDEX send_attempts_legacy_idx;
ALTER TABLE message_events DROP CONSTRAINT message_events_status_check,
 DROP CONSTRAINT message_events_legacy_source_check, DROP CONSTRAINT message_events_owner_check,
 DROP CONSTRAINT message_events_legacy_intent_check;
ALTER TABLE message_events DROP COLUMN legacy_event_id, DROP COLUMN legacy_intent,
 DROP COLUMN jitter_until, DROP COLUMN message_format;
ALTER TABLE message_events ADD CONSTRAINT message_events_status_check CHECK (status IN ('pending','leased','routed','ignored','failed'));
ALTER TABLE send_attempts DROP COLUMN source_message_event_id;
ALTER TABLE follow_gates DROP COLUMN last_untracked_send_at;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792574104231;
COMMIT;
