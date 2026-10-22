CREATE TABLE "report_referral_signups" (
	"user_id" text PRIMARY KEY NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"share_id" uuid,
	"touched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"referral_code" text NOT NULL,
	"request_id" text NOT NULL,
	"created_by" text,
	"pdf_enabled" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_shares_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "report_shares_referral_code_unique" UNIQUE("referral_code"),
	CONSTRAINT "report_shares_snapshot_identity_key" UNIQUE("id","snapshot_id"),
	CONSTRAINT "report_shares_token_hash_check" CHECK ("report_shares"."token_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "report_snapshots" ADD COLUMN "referral_code" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "report_referral_signups" ADD CONSTRAINT "report_referral_signups_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_referral_signups" ADD CONSTRAINT "report_referral_signups_snapshot_id_report_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."report_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_referral_signups" ADD CONSTRAINT "report_referral_signups_share_id_snapshot_id_report_shares_id_snapshot_id_fk" FOREIGN KEY ("share_id","snapshot_id") REFERENCES "public"."report_shares"("id","snapshot_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_snapshot_id_campaign_id_report_snapshots_id_campaign_id_fk" FOREIGN KEY ("snapshot_id","campaign_id") REFERENCES "public"."report_snapshots"("id","campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_referral_signups_share_idx" ON "report_referral_signups" USING btree ("share_id");--> statement-breakpoint
CREATE INDEX "report_referral_signups_snapshot_idx" ON "report_referral_signups" USING btree ("snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_shares_request_key" ON "report_shares" USING btree ("campaign_id","request_id");--> statement-breakpoint
CREATE INDEX "report_shares_campaign_idx" ON "report_shares" USING btree ("campaign_id");--> statement-breakpoint
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_referral_code_unique" UNIQUE("referral_code");