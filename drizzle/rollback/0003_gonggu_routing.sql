-- Empty routing data only. Prefer flag-off rollback while preserving durable jobs.
BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at > 1792562628808) THEN
  RAISE EXCEPTION 'Rollback newer migrations first';
 END IF;
 IF EXISTS (SELECT 1 FROM dm_jobs) OR EXISTS (SELECT 1 FROM campaign_participants)
 OR EXISTS (SELECT 1 FROM private_reply_claims)
 OR EXISTS (SELECT 1 FROM comment_events WHERE route_owner <> 'legacy' OR campaign_id IS NOT NULL OR flag_checked_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Campaign routing data exists: use flag-off rollback and retain the schema';
 END IF;
END $$;
DROP TABLE private_reply_claims, campaign_deliveries;
DROP TABLE dm_jobs;
DROP TABLE campaign_participants;
DROP INDEX comment_events_campaign_queue_idx, comment_events_campaign_idx;
ALTER TABLE comment_events DROP COLUMN campaign_id, DROP COLUMN route_owner,
 DROP COLUMN state_at_receipt, DROP COLUMN stored_state_at_receipt, DROP COLUMN campaign_version_at_receipt,
 DROP COLUMN campaign_rules_snapshot, DROP COLUMN flag_checked_at, DROP COLUMN comment_created_at,
 DROP COLUMN timestamp_source, DROP COLUMN matched_rule;
ALTER TABLE campaigns DROP COLUMN public_reply_sequence;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792562628808;
COMMIT;
