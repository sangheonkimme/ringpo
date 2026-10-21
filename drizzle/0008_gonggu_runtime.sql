ALTER TABLE "message_events" DROP CONSTRAINT "message_events_status_check";--> statement-breakpoint
ALTER TABLE "follow_gates" ADD COLUMN "last_untracked_send_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_events" ADD COLUMN "legacy_event_id" uuid;--> statement-breakpoint
ALTER TABLE "message_events" ADD COLUMN "legacy_intent" text;--> statement-breakpoint
ALTER TABLE "message_events" ADD COLUMN "jitter_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_events" ADD COLUMN "message_format" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "send_attempts" ADD COLUMN "source_message_event_id" uuid;--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_legacy_event_id_comment_events_id_fk" FOREIGN KEY ("legacy_event_id") REFERENCES "public"."comment_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_attempts" ADD CONSTRAINT "send_attempts_source_message_event_id_message_events_id_fk" FOREIGN KEY ("source_message_event_id") REFERENCES "public"."message_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_events_expiry_idx" ON "message_events" USING btree ("occurred_at") WHERE "message_events"."status" = 'pending' and "message_events"."kind" in ('message','postback');--> statement-breakpoint
CREATE INDEX "message_events_campaign_status_idx" ON "message_events" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "message_events_retention_idx" ON "message_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "send_attempts_message_idx" ON "send_attempts" USING btree ("source_message_event_id");--> statement-breakpoint
CREATE INDEX "send_attempts_legacy_idx" ON "send_attempts" USING btree ("legacy_event_id") WHERE "send_attempts"."legacy_event_id" is not null;--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_legacy_source_check" CHECK ("message_events"."legacy_intent" is null or "message_events"."legacy_event_id" is not null);--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_owner_check" CHECK ("message_events"."campaign_id" is null or "message_events"."legacy_event_id" is null);--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_legacy_intent_check" CHECK ("message_events"."legacy_intent" is null or "message_events"."legacy_intent" in ('link','reminder'));--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_status_check" CHECK ("message_events"."status" in ('pending','leased','routed','ignored','failed','send_unknown'));