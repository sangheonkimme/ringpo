BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at > 1792570047258) THEN
  RAISE EXCEPTION 'Rollback newer migrations first';
 END IF;
 IF EXISTS (SELECT 1 FROM comment_events WHERE guarded_jitter_until IS NOT NULL OR status = 'send_unknown')
 OR EXISTS (SELECT 1 FROM send_attempts WHERE legacy_event_id IS NOT NULL)
 OR EXISTS (SELECT 1 FROM account_send_controls WHERE NOT last_observed_enabled) THEN
  RAISE EXCEPTION 'Shared send history exists: keep the schema and compatible budget adapter';
 END IF;
END $$;
ALTER TABLE comment_events DROP COLUMN send_lease_version, DROP COLUMN guarded_jitter_until;
ALTER TABLE account_send_controls DROP COLUMN last_observed_enabled;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792570047258;
COMMIT;
