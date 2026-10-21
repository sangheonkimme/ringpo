CREATE TABLE "message_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ig_account_id" uuid NOT NULL,
	"peer_id" text NOT NULL,
	"event_key" text NOT NULL,
	"provider_message_id" text,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone,
	"received_at" timestamp with time zone NOT NULL,
	"user_message_evidence" boolean NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"payload" text,
	"reply_to_message_id" text,
	"deleted_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone,
	"lease_version" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"campaign_id" uuid,
	"completed_at" timestamp with time zone,
	CONSTRAINT "message_events_delivery_key" UNIQUE("ig_account_id","event_key"),
	CONSTRAINT "message_events_kind_check" CHECK ("message_events"."kind" in ('message','postback','echo','deleted')),
	CONSTRAINT "message_events_status_check" CHECK ("message_events"."status" in ('pending','leased','routed','ignored','failed')),
	CONSTRAINT "message_events_evidence_check" CHECK (not "message_events"."user_message_evidence" or ("message_events"."kind" = 'message' and "message_events"."occurred_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "dm_jobs" ADD COLUMN "source_message_event_id" uuid;--> statement-breakpoint
ALTER TABLE "dm_jobs" ADD COLUMN "follow_check_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_ig_account_id_ig_accounts_id_fk" FOREIGN KEY ("ig_account_id") REFERENCES "public"."ig_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_events_due_idx" ON "message_events" USING btree ("next_attempt_at") WHERE "message_events"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "message_events_lease_idx" ON "message_events" USING btree ("lease_until") WHERE "message_events"."status" = 'leased';--> statement-breakpoint
CREATE INDEX "message_events_peer_idx" ON "message_events" USING btree ("ig_account_id","peer_id","received_at");--> statement-breakpoint
CREATE INDEX "message_events_provider_idx" ON "message_events" USING btree ("ig_account_id","provider_message_id");--> statement-breakpoint
ALTER TABLE "dm_jobs" ADD CONSTRAINT "dm_jobs_source_message_event_id_message_events_id_fk" FOREIGN KEY ("source_message_event_id") REFERENCES "public"."message_events"("id") ON DELETE cascade ON UPDATE no action;