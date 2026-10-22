BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at > 1792629686323) THEN
    RAISE EXCEPTION 'Rollback newer migrations first';
  END IF;
  IF EXISTS (SELECT 1 FROM comment_events WHERE content_redacted_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM message_events WHERE content_redacted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Content redaction history exists: preserve retention evidence';
  END IF;
END $$;
DROP INDEX comment_events_content_retention_idx;
DROP INDEX message_events_content_retention_idx;
DROP INDEX send_attempts_payload_retention_idx;
DROP INDEX dm_jobs_comment_source_idx;
DROP INDEX message_events_legacy_idx;
ALTER TABLE comment_events DROP COLUMN content_redacted_at;
ALTER TABLE message_events DROP COLUMN content_redacted_at;
DELETE FROM campaign_policies WHERE key = 'raw_content_retention_days';
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792629686323;
COMMIT;
