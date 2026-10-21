ALTER TABLE "account_send_controls" ADD COLUMN "last_observed_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_events" ADD COLUMN "send_lease_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_events" ADD COLUMN "guarded_jitter_until" timestamp with time zone;