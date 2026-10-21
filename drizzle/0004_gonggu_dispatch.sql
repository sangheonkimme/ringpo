CREATE TABLE "account_send_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ig_account_id" uuid NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_send_controls" (
	"ig_account_id" uuid PRIMARY KEY NOT NULL,
	"manual_paused" boolean DEFAULT false NOT NULL,
	"continue_dm_on_public_pause" boolean DEFAULT false NOT NULL,
	"private_reply_rate" integer NOT NULL,
	"public_reply_rate" integer NOT NULL,
	"message_rate" integer NOT NULL,
	"warmup_until" timestamp with time zone,
	"api_paused_until" timestamp with time zone,
	"safety_until" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_send_controls_rates" CHECK ("account_send_controls"."private_reply_rate" between 1 and 750 and "account_send_controls"."public_reply_rate" > 0 and "account_send_controls"."message_rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "campaign_notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ig_account_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"resume_at" timestamp with time zone,
	"status" text DEFAULT 'waiting' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_notification_outbox_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "campaign_rate_buckets" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"tokens" double precision DEFAULT 1 NOT NULL,
	"refilled_at" timestamp with time zone NOT NULL,
	"next_eligible_at" timestamp with time zone NOT NULL,
	CONSTRAINT "campaign_rate_buckets_tokens" CHECK ("campaign_rate_buckets"."tokens" >= 0 and "campaign_rate_buckets"."tokens" <= 1)
);
--> statement-breakpoint
CREATE TABLE "conversation_states" (
	"ig_account_id" uuid NOT NULL,
	"sender_id" text NOT NULL,
	"consent_at" timestamp with time zone,
	"last_user_interaction_at" timestamp with time zone,
	"last_user_event_id" text,
	"automation_paused_until" timestamp with time zone,
	"current_campaign_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_states_ig_account_id_sender_id_pk" PRIMARY KEY("ig_account_id","sender_id")
);
--> statement-breakpoint
CREATE TABLE "send_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ig_account_id" uuid NOT NULL,
	"campaign_id" uuid,
	"job_id" uuid,
	"legacy_event_id" uuid,
	"logical_key" text NOT NULL,
	"channel" text NOT NULL,
	"attempt" integer NOT NULL,
	"lease_owner" text NOT NULL,
	"lease_version" integer NOT NULL,
	"state" text DEFAULT 'sending' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"permit_expires_at" timestamp with time zone NOT NULL,
	"invoked_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"provider_message_id" text,
	"error_code" text,
	"request_fingerprint" text NOT NULL,
	"payload" jsonb,
	"late_result" jsonb,
	CONSTRAINT "send_attempts_source_check" CHECK (("send_attempts"."job_id" is null) <> ("send_attempts"."legacy_event_id" is null))
);
--> statement-breakpoint
CREATE TABLE "send_buckets" (
	"ig_account_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"tokens" double precision DEFAULT 1 NOT NULL,
	"refilled_at" timestamp with time zone NOT NULL,
	"next_eligible_at" timestamp with time zone NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"lease_job_id" uuid,
	"error_streak" integer DEFAULT 0 NOT NULL,
	"streak_started_at" timestamp with time zone,
	"paused_until" timestamp with time zone,
	"requires_review" boolean DEFAULT false NOT NULL,
	"last_error_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "send_buckets_ig_account_id_channel_pk" PRIMARY KEY("ig_account_id","channel"),
	CONSTRAINT "send_buckets_tokens" CHECK ("send_buckets"."tokens" >= 0 and "send_buckets"."tokens" <= 1)
);
--> statement-breakpoint
ALTER TABLE "dm_jobs" ADD COLUMN "jitter_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dm_jobs" ADD COLUMN "message_format" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_send_audit_events" ADD CONSTRAINT "account_send_audit_events_ig_account_id_ig_accounts_id_fk" FOREIGN KEY ("ig_account_id") REFERENCES "public"."ig_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_send_audit_events" ADD CONSTRAINT "account_send_audit_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_send_controls" ADD CONSTRAINT "account_send_controls_ig_account_id_ig_accounts_id_fk" FOREIGN KEY ("ig_account_id") REFERENCES "public"."ig_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_notification_outbox" ADD CONSTRAINT "campaign_notification_outbox_ig_account_id_ig_accounts_id_fk" FOREIGN KEY ("ig_account_id") REFERENCES "public"."ig_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_notification_outbox" ADD CONSTRAINT "campaign_notification_outbox_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_rate_buckets" ADD CONSTRAINT "campaign_rate_buckets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_states" ADD CONSTRAINT "conversation_states_ig_account_id_ig_accounts_id_fk" FOREIGN KEY ("ig_account_id") REFERENCES "public"."ig_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_states" ADD CONSTRAINT "conversation_states_current_campaign_id_campaigns_id_fk" FOREIGN KEY ("current_campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_attempts" ADD CONSTRAINT "send_attempts_ig_account_id_ig_accounts_id_fk" FOREIGN KEY ("ig_account_id") REFERENCES "public"."ig_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_attempts" ADD CONSTRAINT "send_attempts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_attempts" ADD CONSTRAINT "send_attempts_job_id_dm_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."dm_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_attempts" ADD CONSTRAINT "send_attempts_legacy_event_id_comment_events_id_fk" FOREIGN KEY ("legacy_event_id") REFERENCES "public"."comment_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_buckets" ADD CONSTRAINT "send_buckets_ig_account_id_account_send_controls_ig_account_id_fk" FOREIGN KEY ("ig_account_id") REFERENCES "public"."account_send_controls"("ig_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_buckets" ADD CONSTRAINT "send_buckets_lease_job_id_dm_jobs_id_fk" FOREIGN KEY ("lease_job_id") REFERENCES "public"."dm_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_send_audit_request_unique" ON "account_send_audit_events" USING btree ("ig_account_id","request_id");--> statement-breakpoint
CREATE INDEX "campaign_notification_queue_idx" ON "campaign_notification_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "send_attempts_logical_unique" ON "send_attempts" USING btree ("logical_key","attempt");--> statement-breakpoint
CREATE INDEX "send_attempts_account_window_idx" ON "send_attempts" USING btree ("ig_account_id","channel","started_at");--> statement-breakpoint
CREATE INDEX "send_attempts_campaign_window_idx" ON "send_attempts" USING btree ("campaign_id","channel","started_at");--> statement-breakpoint
CREATE INDEX "send_attempts_job_idx" ON "send_attempts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "send_attempts_provider_idx" ON "send_attempts" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "send_buckets_ready_idx" ON "send_buckets" USING btree ("next_eligible_at");
--> statement-breakpoint
-- GONGGU_DEFAULTS
INSERT INTO campaign_policies (key, value) VALUES ('dispatch_lease_seconds', 60), ('send_permit_ms', 2000);
