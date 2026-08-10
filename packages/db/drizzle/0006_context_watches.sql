CREATE TABLE IF NOT EXISTS "watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"person_label" varchar(200),
	"email" varchar(320),
	"commitment_id" uuid,
	"armed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"alert_sent_at" timestamp with time zone,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watches_user_status_kind_idx" ON "watches" USING btree ("user_id","status","kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watches_status_kind_idx" ON "watches" USING btree ("status","kind");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "watches" ADD CONSTRAINT "watches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "watches" ADD CONSTRAINT "watches_commitment_id_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."commitments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
