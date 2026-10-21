-- Preserve links already sent to recipients. Production rollback keeps this additive schema.
BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at > 1792569091806) THEN
  RAISE EXCEPTION 'Rollback newer migrations first';
 END IF;
 IF EXISTS (SELECT 1 FROM campaign_tracked_links) OR EXISTS (SELECT 1 FROM campaign_link_catalogs)
 OR EXISTS (SELECT 1 FROM campaign_click_events) THEN
  RAISE EXCEPTION 'Campaign tracking data exists: use flag-off rollback and retain the schema';
 END IF;
END $$;
DROP TABLE campaign_click_events, campaign_link_catalogs, campaign_tracked_links;
ALTER TABLE campaign_products DROP CONSTRAINT campaign_products_identity_key;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792569091806;
COMMIT;
