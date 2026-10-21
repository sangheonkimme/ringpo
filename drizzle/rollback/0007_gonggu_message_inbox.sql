BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at > 1792572325826) THEN
  RAISE EXCEPTION 'Rollback newer migrations first';
 END IF;
 IF EXISTS (SELECT 1 FROM message_events)
 OR EXISTS (SELECT 1 FROM dm_jobs WHERE source_message_event_id IS NOT NULL OR follow_check_attempts > 0) THEN
  RAISE EXCEPTION 'Message inbox history exists: preserve consent, source and deduplication evidence';
 END IF;
END $$;
ALTER TABLE dm_jobs DROP COLUMN source_message_event_id, DROP COLUMN follow_check_attempts;
DROP TABLE message_events;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792572325826;
COMMIT;
