ALTER TABLE "campaign_products" ADD CONSTRAINT "campaign_products_identity_key" UNIQUE("id","campaign_id");
--> statement-breakpoint
CREATE TABLE "campaign_click_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"recipient_hash" text NOT NULL,
	"clicked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "campaign_click_events_recipient_hash" CHECK ("campaign_click_events"."recipient_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "campaign_link_catalogs" (
	"code" text PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"job_id" uuid,
	"content_hash" text NOT NULL,
	"title" text NOT NULL,
	"brand" text NOT NULL,
	"products" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_tracked_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"campaign_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"job_id" uuid,
	"recipient_hash" text NOT NULL,
	"target_url" text NOT NULL,
	"target_hash" text NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"first_clicked_at" timestamp with time zone,
	"last_clicked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_tracked_links_code_unique" UNIQUE("code"),
	CONSTRAINT "campaign_tracked_links_recipient_hash" CHECK ("campaign_tracked_links"."recipient_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "campaign_click_events" ADD CONSTRAINT "campaign_click_events_link_id_campaign_tracked_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."campaign_tracked_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_click_events" ADD CONSTRAINT "campaign_click_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_click_events" ADD CONSTRAINT "campaign_click_events_product_id_campaign_id_campaign_products_id_campaign_id_fk" FOREIGN KEY ("product_id","campaign_id") REFERENCES "public"."campaign_products"("id","campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_link_catalogs" ADD CONSTRAINT "campaign_link_catalogs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_link_catalogs" ADD CONSTRAINT "campaign_link_catalogs_job_id_dm_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."dm_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_tracked_links" ADD CONSTRAINT "campaign_tracked_links_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_tracked_links" ADD CONSTRAINT "campaign_tracked_links_job_id_dm_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."dm_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_tracked_links" ADD CONSTRAINT "campaign_tracked_links_product_id_campaign_id_campaign_products_id_campaign_id_fk" FOREIGN KEY ("product_id","campaign_id") REFERENCES "public"."campaign_products"("id","campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_click_events_campaign_time_idx" ON "campaign_click_events" USING btree ("campaign_id","clicked_at");--> statement-breakpoint
CREATE INDEX "campaign_click_events_product_idx" ON "campaign_click_events" USING btree ("campaign_id","product_id");--> statement-breakpoint
CREATE INDEX "campaign_link_catalogs_campaign_idx" ON "campaign_link_catalogs" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_link_catalogs_job_content_key" ON "campaign_link_catalogs" USING btree ("job_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_tracked_links_job_product_target_key" ON "campaign_tracked_links" USING btree ("job_id","product_id","target_hash");--> statement-breakpoint
CREATE INDEX "campaign_tracked_links_campaign_idx" ON "campaign_tracked_links" USING btree ("campaign_id");
