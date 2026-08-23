CREATE TABLE IF NOT EXISTS "access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"phone_e164" varchar(20) NOT NULL,
	"email" varchar(200) NOT NULL,
	"source" varchar(120),
	"detail" text,
	"status" varchar(20) DEFAULT 'new' NOT NULL,
	"invite_id" uuid,
	"user_id" uuid,
	"admin_note" text,
	"page_url" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(200) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_requests_status_created_idx" ON "access_requests" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_requests_phone_idx" ON "access_requests" USING btree ("phone_e164");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admin_sessions_token_hash_uidx" ON "admin_sessions" USING btree ("token_hash");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
