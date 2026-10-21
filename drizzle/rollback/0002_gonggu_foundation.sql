-- Empty-data rollback only. Disable the flag and stop campaign workers first.
-- Refuses newer migrations and existing campaigns. Export data before any destructive rollback.
BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at > 1792561710063) THEN
  RAISE EXCEPTION 'Rollback newer migrations first';
 END IF;
 IF EXISTS (SELECT 1 FROM campaigns) THEN
  RAISE EXCEPTION 'Campaign data exists: use flag-off rollback and retain the schema';
 END IF;
END $$;
DROP TABLE campaign_audit_events, campaign_media, campaign_products;
DROP TABLE campaigns;
DROP TABLE feature_flag_overrides, feature_flags, plan_entitlements, campaign_policies;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792561710063;
COMMIT;
