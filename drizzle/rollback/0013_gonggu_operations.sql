BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at > 1792630675658) THEN RAISE EXCEPTION 'Rollback newer migrations first'; END IF;
  IF EXISTS (SELECT 1 FROM dm_jobs WHERE retry_allowance <> 0) THEN RAISE EXCEPTION 'Manual retry evidence exists: preserve retry allowance'; END IF;
END $$;
DROP INDEX dm_jobs_operations_idx;
ALTER TABLE dm_jobs DROP CONSTRAINT dm_jobs_retry_allowance_check;
ALTER TABLE dm_jobs DROP COLUMN retry_allowance;
DELETE FROM campaign_policies WHERE key = 'manual_retry_extra_attempts';
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792630675658;
COMMIT;
