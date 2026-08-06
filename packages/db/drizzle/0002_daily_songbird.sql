CREATE TABLE "google_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" varchar(40) DEFAULT 'personal' NOT NULL,
	"email" varchar(320),
	"scopes" text DEFAULT '' NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"gmail_history_id" varchar(80),
	"calendar_sync_token" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_accounts" ADD CONSTRAINT "google_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "google_accounts_user_label_uidx" ON "google_accounts" USING btree ("user_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "events_user_source_source_id_uidx" ON "events" USING btree ("user_id","source","source_id");