CREATE TABLE "campaign_report_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"finalized" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_report_requests_status_check" CHECK ("campaign_report_requests"."status" in ('waiting','done','failed') and "campaign_report_requests"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "manual_order_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"actor_id" text,
	"revision" integer NOT NULL,
	"request_id" text NOT NULL,
	"order_count" integer NOT NULL,
	"revenue_krw" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_orders_values_check" CHECK ("manual_order_entries"."revision" > 0 and "manual_order_entries"."order_count" between 0 and 1000000000 and "manual_order_entries"."revenue_krw" between 0 and 9000000000000)
);
--> statement-breakpoint
CREATE TABLE "report_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"source_key" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"finalized" boolean DEFAULT false NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_snapshots_identity_key" UNIQUE("id","campaign_id"),
	CONSTRAINT "report_snapshots_revision_check" CHECK ("report_snapshots"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "campaign_report_requests" ADD CONSTRAINT "campaign_report_requests_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_report_requests" ADD CONSTRAINT "campaign_report_requests_snapshot_id_campaign_id_report_snapshots_id_campaign_id_fk" FOREIGN KEY ("snapshot_id","campaign_id") REFERENCES "public"."report_snapshots"("id","campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_order_entries" ADD CONSTRAINT "manual_order_entries_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_order_entries" ADD CONSTRAINT "manual_order_entries_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_report_requests_source_key" ON "campaign_report_requests" USING btree ("campaign_id","source_key");--> statement-breakpoint
CREATE INDEX "campaign_report_requests_queue_idx" ON "campaign_report_requests" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_orders_revision_key" ON "manual_order_entries" USING btree ("campaign_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_orders_request_key" ON "manual_order_entries" USING btree ("campaign_id","request_id");--> statement-breakpoint
CREATE INDEX "manual_orders_campaign_time_idx" ON "manual_order_entries" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_snapshots_revision_key" ON "report_snapshots" USING btree ("campaign_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "report_snapshots_source_key" ON "report_snapshots" USING btree ("campaign_id","source_key");