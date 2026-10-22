ALTER TABLE "dm_jobs" ADD COLUMN "retry_allowance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "dm_jobs_operations_idx" ON "dm_jobs" USING btree ("ig_account_id","status","next_attempt_at");--> statement-breakpoint
ALTER TABLE "dm_jobs" ADD CONSTRAINT "dm_jobs_retry_allowance_check" CHECK ("dm_jobs"."retry_allowance" between 0 and 10);--> statement-breakpoint
-- GONGGU_DEFAULTS
INSERT INTO campaign_policies (key, value) VALUES ('manual_retry_extra_attempts', 5) ON CONFLICT DO NOTHING;
