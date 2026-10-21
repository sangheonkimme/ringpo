-- Only for an unused migration. Preserve all entered totals and issued report revisions.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at > 1792577218753) THEN
    RAISE EXCEPTION 'Rollback newer migrations first';
  END IF;
  IF EXISTS (SELECT 1 FROM manual_order_entries) OR EXISTS (SELECT 1 FROM report_snapshots) OR EXISTS (SELECT 1 FROM campaign_report_requests) THEN
    RAISE EXCEPTION 'Report history exists: use flag OFF / compatible code rollback instead';
  END IF;
END $$;
DROP TABLE campaign_report_requests;
DROP TABLE report_snapshots;
DROP TABLE manual_order_entries;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792577218753;
COMMIT;
