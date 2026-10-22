BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at > 1792628509466) THEN
    RAISE EXCEPTION 'Rollback newer migrations first';
  END IF;
  IF EXISTS (SELECT 1 FROM campaign_faqs) OR EXISTS (SELECT 1 FROM dm_jobs WHERE kind = 'faq')
    OR EXISTS (SELECT 1 FROM conversation_states WHERE pending_echo_event_id IS NOT NULL OR last_human_at IS NOT NULL OR last_faq_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM feature_flag_overrides WHERE flag_key = 'gonggu_faq_handoff_verified') THEN
    RAISE EXCEPTION 'FAQ or handoff history exists: preserve source and conversation protections';
  END IF;
END $$;
ALTER TABLE dm_jobs DROP CONSTRAINT dm_jobs_faq_check;
ALTER TABLE dm_jobs DROP CONSTRAINT dm_jobs_faq_id_campaign_id_campaign_faqs_id_campaign_id_fk;
DROP INDEX dm_jobs_faq_source_key;
ALTER TABLE dm_jobs DROP COLUMN faq_id, DROP COLUMN faq_revision_used;
ALTER TABLE conversation_states DROP COLUMN pending_echo_event_id, DROP COLUMN last_human_at, DROP COLUMN last_faq_at;
DROP TABLE campaign_faqs;
DELETE FROM feature_flags WHERE key = 'gonggu_faq_handoff_verified';
DELETE FROM campaign_policies WHERE key IN ('faq_max_rules','faq_cooldown_seconds','faq_handoff_seconds');
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792628509466;
COMMIT;
