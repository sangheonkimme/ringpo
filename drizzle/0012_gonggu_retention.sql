ALTER TABLE "comment_events" ADD COLUMN "content_redacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_events" ADD COLUMN "content_redacted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "comment_events_content_retention_idx" ON "comment_events" USING btree ("received_at") WHERE "comment_events"."content_redacted_at" is null and ("comment_events"."flag_checked_at" is not null or "comment_events"."guarded_jitter_until" is not null or "comment_events"."campaign_id" is not null);--> statement-breakpoint
CREATE INDEX "dm_jobs_comment_source_idx" ON "dm_jobs" USING btree ("source_event_id") WHERE "dm_jobs"."source_event_id" is not null;--> statement-breakpoint
CREATE INDEX "message_events_legacy_idx" ON "message_events" USING btree ("legacy_event_id") WHERE "message_events"."legacy_event_id" is not null;--> statement-breakpoint
CREATE INDEX "message_events_content_retention_idx" ON "message_events" USING btree ("received_at") WHERE "message_events"."content_redacted_at" is null;--> statement-breakpoint
CREATE INDEX "send_attempts_payload_retention_idx" ON "send_attempts" USING btree ("started_at") WHERE "send_attempts"."payload" is not null;
--> statement-breakpoint
-- GONGGU_DEFAULTS
INSERT INTO campaign_policies (key, value) VALUES ('raw_content_retention_days', 90) ON CONFLICT DO NOTHING;
