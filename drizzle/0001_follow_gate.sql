CREATE TABLE "follow_gates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"ig_account_id" uuid NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"checks" integer DEFAULT 0 NOT NULL,
	"sender_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "follow_gates_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "follow_gate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "follow_gate_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "follow_gates" ADD CONSTRAINT "follow_gates_event_id_comment_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."comment_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_gates" ADD CONSTRAINT "follow_gates_ig_account_id_ig_accounts_id_fk" FOREIGN KEY ("ig_account_id") REFERENCES "public"."ig_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "follow_gates_account_idx" ON "follow_gates" USING btree ("ig_account_id","status");