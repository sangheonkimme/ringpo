CREATE TABLE "campaign_deliveries" (
	"participant_id" uuid NOT NULL,
	"intent" text NOT NULL,
	"owning_job_id" uuid NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_deliveries_participant_id_intent_pk" PRIMARY KEY("participant_id","intent")
);
--> statement-breakpoint
CREATE TABLE "campaign_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"ig_account_id" uuid NOT NULL,
	"commenter_ig_id" text NOT NULL,
	"recipient_hash" text NOT NULL,
	"first_event_id" uuid,
	"first_comment_created_at" timestamp with time zone NOT NULL,
	"notification_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_participants_person_key" UNIQUE("campaign_id","commenter_ig_id"),
	CONSTRAINT "campaign_participants_identity_key" UNIQUE("id","campaign_id","ig_account_id"),
	CONSTRAINT "campaign_participants_hash_check" CHECK ("campaign_participants"."recipient_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "dm_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"ig_account_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"source_event_id" uuid,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"hard_expires_at" timestamp with time zone NOT NULL,
	"comment_created_at" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"public_template_index" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"lease_version" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"template_revision_used" integer,
	"provider_message_id" text,
	"last_error_code" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dm_jobs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "dm_jobs_participant_key" UNIQUE("id","participant_id"),
	CONSTRAINT "dm_jobs_channel_check" CHECK ("dm_jobs"."channel" in ('public_reply','private_reply','message')),
	CONSTRAINT "dm_jobs_status_check" CHECK ("dm_jobs"."status" in ('waiting','leased','sending','retry','sent','failed','expired','skipped_duplicate','canceled','held','unknown')),
	CONSTRAINT "dm_jobs_source_check" CHECK ("dm_jobs"."channel" = 'message' or "dm_jobs"."source_event_id" is not null),
	CONSTRAINT "dm_jobs_deadline_check" CHECK ("dm_jobs"."deadline_at" <= "dm_jobs"."hard_expires_at")
);
--> statement-breakpoint
CREATE TABLE "private_reply_claims" (
	"comment_id" text PRIMARY KEY NOT NULL,
	"job_id" uuid,
	"legacy_event_id" uuid,
	"state" text DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_reply_claims_owner_check" CHECK (("private_reply_claims"."job_id" is null) <> ("private_reply_claims"."legacy_event_id" is null))
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "public_reply_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_events" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "comment_events" ADD COLUMN "route_owner" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_events" ADD COLUMN "state_at_receipt" text;--> statement-breakpoint
ALTER TABLE "comment_events" ADD COLUMN "stored_state_at_receipt" text;--> statement-breakpoint
ALTER TABLE "comment_events" ADD COLUMN "campaign_version_at_receipt" integer;--> statement-breakpoint
ALTER TABLE "comment_events" ADD COLUMN "campaign_rules_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "comment_events" ADD COLUMN "flag_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comment_events" ADD COLUMN "comment_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comment_events" ADD COLUMN "timestamp_source" text;--> statement-breakpoint
ALTER TABLE "comment_events" ADD COLUMN "matched_rule" text;--> statement-breakpoint
ALTER TABLE "campaign_deliveries" ADD CONSTRAINT "campaign_deliveries_participant_id_campaign_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."campaign_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_deliveries" ADD CONSTRAINT "campaign_deliveries_owning_job_id_participant_id_dm_jobs_id_participant_id_fk" FOREIGN KEY ("owning_job_id","participant_id") REFERENCES "public"."dm_jobs"("id","participant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_participants" ADD CONSTRAINT "campaign_participants_first_event_id_comment_events_id_fk" FOREIGN KEY ("first_event_id") REFERENCES "public"."comment_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_participants" ADD CONSTRAINT "campaign_participants_campaign_id_ig_account_id_campaigns_id_ig_account_id_fk" FOREIGN KEY ("campaign_id","ig_account_id") REFERENCES "public"."campaigns"("id","ig_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_jobs" ADD CONSTRAINT "dm_jobs_source_event_id_comment_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."comment_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_jobs" ADD CONSTRAINT "dm_jobs_campaign_id_ig_account_id_campaigns_id_ig_account_id_fk" FOREIGN KEY ("campaign_id","ig_account_id") REFERENCES "public"."campaigns"("id","ig_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_jobs" ADD CONSTRAINT "dm_jobs_participant_id_campaign_id_ig_account_id_campaign_participants_id_campaign_id_ig_account_id_fk" FOREIGN KEY ("participant_id","campaign_id","ig_account_id") REFERENCES "public"."campaign_participants"("id","campaign_id","ig_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_reply_claims" ADD CONSTRAINT "private_reply_claims_comment_id_comment_events_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment_events"("comment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_reply_claims" ADD CONSTRAINT "private_reply_claims_job_id_dm_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."dm_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_reply_claims" ADD CONSTRAINT "private_reply_claims_legacy_event_id_comment_events_id_fk" FOREIGN KEY ("legacy_event_id") REFERENCES "public"."comment_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dm_jobs_due_idx" ON "dm_jobs" USING btree ("next_attempt_at") WHERE "dm_jobs"."status" in ('waiting','retry');--> statement-breakpoint
CREATE INDEX "dm_jobs_account_edf_idx" ON "dm_jobs" USING btree ("ig_account_id","channel","deadline_at","comment_created_at","id") WHERE "dm_jobs"."status" in ('waiting','retry');--> statement-breakpoint
CREATE INDEX "dm_jobs_campaign_status_idx" ON "dm_jobs" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "dm_jobs_lease_idx" ON "dm_jobs" USING btree ("lease_until") WHERE "dm_jobs"."status" in ('leased','sending');--> statement-breakpoint
ALTER TABLE "comment_events" ADD CONSTRAINT "comment_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_events_campaign_queue_idx" ON "comment_events" USING btree ("run_at") WHERE "comment_events"."status" in ('campaign_pending', 'campaign_processing');--> statement-breakpoint
CREATE INDEX "comment_events_campaign_idx" ON "comment_events" USING btree ("campaign_id","received_at");