BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at > 1792578335686) THEN
    RAISE EXCEPTION 'Rollback newer migrations first';
  END IF;
  IF EXISTS (SELECT 1 FROM report_shares) OR EXISTS (SELECT 1 FROM report_referral_signups) OR EXISTS (SELECT 1 FROM report_snapshots) THEN
    RAISE EXCEPTION 'Report/PDF referral history exists: preserve issued capabilities and attribution';
  END IF;
END $$;
DROP TABLE report_referral_signups;
DROP TABLE report_shares;
ALTER TABLE report_snapshots DROP COLUMN referral_code;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792578335686;
COMMIT;
