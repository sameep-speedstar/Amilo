CREATE TABLE IF NOT EXISTS "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" varchar(20) NOT NULL,
	"address" text,
	"lat" double precision,
	"lng" double precision,
	"source" varchar(20),
	"last_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geocode_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address_key" varchar(500) NOT NULL,
	"address_text" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"resolved" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "geocode_cache_address_key_unique" UNIQUE("address_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "travel_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_kind" varchar(20) DEFAULT 'event' NOT NULL,
	"item_id" uuid NOT NULL,
	"occurrence_date" date NOT NULL,
	"item_start_at" timestamp with time zone NOT NULL,
	"item_title" text,
	"destination_text" text NOT NULL,
	"destination_lat" double precision,
	"destination_lng" double precision,
	"origin_label" varchar(200) NOT NULL,
	"origin_place_id" uuid,
	"origin_lat" double precision,
	"origin_lng" double precision,
	"travel_mins" integer,
	"leave_by" timestamp with time zone,
	"computed_at" timestamp with time zone,
	"last_check_stage" varchar(10),
	"last_check_at" timestamp with time zone,
	"alert_sent_at" timestamp with time zone,
	"escalated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "places_user_label_uidx" ON "places" USING btree ("user_id","label");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "travel_plans_occurrence_uidx" ON "travel_plans" USING btree ("user_id","item_kind","item_id","occurrence_date");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "places" ADD CONSTRAINT "places_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "travel_plans" ADD CONSTRAINT "travel_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "travel_plans" ADD CONSTRAINT "travel_plans_origin_place_id_places_id_fk" FOREIGN KEY ("origin_place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
