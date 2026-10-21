CREATE TABLE "campaign_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"from_state" text,
	"to_state" text,
	"version" integer NOT NULL,
	"request_id" text NOT NULL,
	"reason" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"ig_account_id" uuid NOT NULL,
	"media_id" text NOT NULL,
	"permalink" text,
	"routing_enabled" boolean DEFAULT false NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaign_policies" (
	"key" text PRIMARY KEY NOT NULL,
	"value" integer NOT NULL,
	CONSTRAINT "campaign_policies_positive" CHECK ("campaign_policies"."value" > 0)
);
--> statement-breakpoint
CREATE TABLE "campaign_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"option" text DEFAULT '' NOT NULL,
	"original_url" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"ig_account_id" uuid NOT NULL,
	"title" text NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"open_at" timestamp with time zone NOT NULL,
	"close_at" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"notification_keywords" text[] NOT NULL,
	"link_keywords" text[] NOT NULL,
	"excluded_keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"match_type" text DEFAULT 'contains' NOT NULL,
	"templates" jsonb NOT NULL,
	"follow_only" boolean DEFAULT false NOT NULL,
	"follow_failure_policy" text DEFAULT 'send_link' NOT NULL,
	"expiry_fallback_enabled" boolean DEFAULT false NOT NULL,
	"hourly_rate" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_slug_unique" UNIQUE("slug"),
	CONSTRAINT "campaigns_id_account_unique" UNIQUE("id","ig_account_id"),
	CONSTRAINT "campaigns_dates_check" CHECK ("campaigns"."open_at" < "campaigns"."close_at"),
	CONSTRAINT "campaigns_rate_check" CHECK ("campaigns"."hourly_rate" between 1 and 750),
	CONSTRAINT "campaigns_state_check" CHECK ("campaigns"."status" in ('draft','teaser','open','closed','sold_out','settled'))
);
--> statement-breakpoint
CREATE TABLE "feature_flag_overrides" (
	"flag_key" text NOT NULL,
	"ig_account_id" uuid NOT NULL,
	"enabled" boolean NOT NULL,
	CONSTRAINT "feature_flag_overrides_flag_key_ig_account_id_pk" PRIMARY KEY("flag_key","ig_account_id")
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"default_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_entitlements" (
	"plan" text NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"boolean_value" boolean,
	"limit_value" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_entitlements_plan_key_pk" PRIMARY KEY("plan","key"),
	CONSTRAINT "plan_entitlements_value_check" CHECK (("plan_entitlements"."kind" = 'boolean' and "plan_entitlements"."boolean_value" is not null and "plan_entitlements"."limit_value" is null) or ("plan_entitlements"."kind" = 'limit' and "plan_entitlements"."boolean_value" is null and ("plan_entitlements"."limit_value" is null or "plan_entitlements"."limit_value" >= 0)))
);
--> statement-breakpoint
ALTER TABLE "campaign_audit_events" ADD CONSTRAINT "campaign_audit_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_audit_events" ADD CONSTRAINT "campaign_audit_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_media" ADD CONSTRAINT "campaign_media_ig_account_id_ig_accounts_id_fk" FOREIGN KEY ("ig_account_id") REFERENCES "public"."ig_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_media" ADD CONSTRAINT "campaign_media_campaign_account_fk" FOREIGN KEY ("campaign_id","ig_account_id") REFERENCES "public"."campaigns"("id","ig_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_products" ADD CONSTRAINT "campaign_products_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_ig_account_id_ig_accounts_id_fk" FOREIGN KEY ("ig_account_id") REFERENCES "public"."ig_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag_overrides" ADD CONSTRAINT "feature_flag_overrides_flag_key_feature_flags_key_fk" FOREIGN KEY ("flag_key") REFERENCES "public"."feature_flags"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag_overrides" ADD CONSTRAINT "feature_flag_overrides_ig_account_id_ig_accounts_id_fk" FOREIGN KEY ("ig_account_id") REFERENCES "public"."ig_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_audit_request_unique" ON "campaign_audit_events" USING btree ("campaign_id","request_id");--> statement-breakpoint
CREATE INDEX "campaign_audit_campaign_idx" ON "campaign_audit_events" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_media_pair_unique" ON "campaign_media" USING btree ("campaign_id","media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_media_routing_unique" ON "campaign_media" USING btree ("ig_account_id","media_id") WHERE "campaign_media"."routing_enabled" = true;--> statement-breakpoint
CREATE INDEX "campaign_products_campaign_idx" ON "campaign_products" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaigns_user_idx" ON "campaigns" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "campaigns_due_idx" ON "campaigns" USING btree ("open_at","close_at") WHERE "campaigns"."published_at" is not null and "campaigns"."status" in ('draft','teaser','open') and "campaigns"."archived_at" is null;
--> statement-breakpoint
-- GONGGU_DEFAULTS
INSERT INTO feature_flags (key, enabled, default_enabled) VALUES ('gonggu_campaigns', false, false);
INSERT INTO plan_entitlements (plan, key, kind, limit_value) VALUES
 ('free', 'campaign.max_active', 'limit', 1),
 ('pro', 'campaign.max_active', 'limit', NULL);
INSERT INTO plan_entitlements (plan, key, kind, boolean_value)
SELECT plan, key, 'boolean', (plan = 'pro' OR key = 'campaign.basic_clicks')
FROM (VALUES ('free'), ('pro')) AS plans(plan)
CROSS JOIN (VALUES ('campaign.scheduled_dm'), ('campaign.follow_gate'), ('campaign.basic_clicks'),
 ('campaign.report_share'), ('campaign.report_pdf'), ('campaign.faq')) AS features(key);
INSERT INTO campaign_policies (key, value) VALUES
 ('private_reply_default_rate', 400), ('private_reply_max_rate', 750),
 ('public_reply_default_rate', 120), ('message_default_rate', 400),
 ('private_reply_window_seconds', 604800), ('private_reply_safety_seconds', 3600),
 ('message_window_seconds', 86400), ('message_safety_seconds', 60),
 ('jitter_min_ms', 3000), ('jitter_max_ms', 5000), ('max_attempts', 5),
 ('breaker_streak', 5), ('breaker_window_seconds', 300), ('breaker_pause_seconds', 21600),
 ('faq_handoff_seconds', 3600), ('raw_retention_days', 90);
