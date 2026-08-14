CREATE TABLE IF NOT EXISTS "allowed_phones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "phone_e164" varchar(20) NOT NULL,
  "label" varchar(120),
  "note" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "allowed_phones_e164_uidx" ON "allowed_phones" USING btree ("phone_e164");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token" varchar(40) NOT NULL,
  "phone_e164" varchar(20),
  "label" varchar(120),
  "max_uses" integer DEFAULT 1 NOT NULL,
  "use_count" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invites_token_uidx" ON "invites" USING btree ("token");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid,
  "kind" varchar(40) NOT NULL,
  "units" integer DEFAULT 1 NOT NULL,
  "cost_micros" integer DEFAULT 0 NOT NULL,
  "meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "ts" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_user_ts_idx" ON "usage_events" USING btree ("user_id","ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_kind_ts_idx" ON "usage_events" USING btree ("kind","ts");
