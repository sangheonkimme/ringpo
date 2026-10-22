CREATE TABLE "campaign_faqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"keywords" text[] NOT NULL,
	"excluded_keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"match_type" text DEFAULT 'contains' NOT NULL,
	"answer" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_faqs_identity_key" UNIQUE("id","campaign_id"),
	CONSTRAINT "campaign_faqs_match_check" CHECK ("campaign_faqs"."match_type" in ('contains','exact'))
);
--> statement-breakpoint
ALTER TABLE "conversation_states" ADD COLUMN "pending_echo_event_id" text;--> statement-breakpoint
ALTER TABLE "conversation_states" ADD COLUMN "last_human_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_states" ADD COLUMN "last_faq_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dm_jobs" ADD COLUMN "faq_id" uuid;--> statement-breakpoint
ALTER TABLE "dm_jobs" ADD COLUMN "faq_revision_used" integer;--> statement-breakpoint
ALTER TABLE "campaign_faqs" ADD CONSTRAINT "campaign_faqs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_faqs_campaign_idx" ON "campaign_faqs" USING btree ("campaign_id");--> statement-breakpoint
ALTER TABLE "dm_jobs" ADD CONSTRAINT "dm_jobs_faq_id_campaign_id_campaign_faqs_id_campaign_id_fk" FOREIGN KEY ("faq_id","campaign_id") REFERENCES "public"."campaign_faqs"("id","campaign_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dm_jobs_faq_source_key" ON "dm_jobs" USING btree ("source_message_event_id") WHERE "dm_jobs"."kind" = 'faq';--> statement-breakpoint
ALTER TABLE "dm_jobs" ADD CONSTRAINT "dm_jobs_faq_check" CHECK ("dm_jobs"."kind" <> 'faq' or ("dm_jobs"."channel" = 'message' and "dm_jobs"."source_message_event_id" is not null and "dm_jobs"."faq_id" is not null));
--> statement-breakpoint
-- GONGGU_DEFAULTS
INSERT INTO feature_flags (key, enabled, default_enabled) VALUES ('gonggu_faq_handoff_verified', false, false) ON CONFLICT DO NOTHING;
INSERT INTO campaign_policies (key, value) VALUES ('faq_max_rules', 20), ('faq_cooldown_seconds', 60), ('faq_handoff_seconds', 3600) ON CONFLICT DO NOTHING;
