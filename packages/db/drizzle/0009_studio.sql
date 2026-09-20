CREATE TABLE IF NOT EXISTS "studio_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(200) NOT NULL,
	"tagline" text,
	"tz" varchar(50) DEFAULT 'Asia/Kolkata' NOT NULL,
	"brand" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "studio_products_slug_uidx" ON "studio_products" USING btree ("slug");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "studio_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"handle" varchar(200) DEFAULT '' NOT NULL,
	"credentials_enc" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "studio_channels_product_kind_uidx" ON "studio_channels" USING btree ("product_id","kind");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "studio_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"title" varchar(200) DEFAULT 'Untitled plan' NOT NULL,
	"raw_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "studio_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"plan_id" uuid,
	"source" varchar(20) DEFAULT 'plan' NOT NULL,
	"hook" text DEFAULT '' NOT NULL,
	"mockup" jsonb,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_posts_due_idx" ON "studio_posts" USING btree ("status","scheduled_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_posts_product_idx" ON "studio_posts" USING btree ("product_id","scheduled_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "studio_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"channel_kind" varchar(20) NOT NULL,
	"copy" text DEFAULT '' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"remote_id" varchar(200),
	"error" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "studio_targets_post_channel_uidx" ON "studio_targets" USING btree ("post_id","channel_kind");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "studio_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"post_id" uuid,
	"kind" varchar(20) DEFAULT 'upload' NOT NULL,
	"filename" varchar(240) NOT NULL,
	"mime" varchar(80) DEFAULT 'image/png' NOT NULL,
	"bytes_b64" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_assets_post_idx" ON "studio_assets" USING btree ("post_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "studio_channels" ADD CONSTRAINT "studio_channels_product_id_studio_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."studio_products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "studio_plans" ADD CONSTRAINT "studio_plans_product_id_studio_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."studio_products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "studio_posts" ADD CONSTRAINT "studio_posts_product_id_studio_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."studio_products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "studio_posts" ADD CONSTRAINT "studio_posts_plan_id_studio_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."studio_plans"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "studio_targets" ADD CONSTRAINT "studio_targets_post_id_studio_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."studio_posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "studio_assets" ADD CONSTRAINT "studio_assets_product_id_studio_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."studio_products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "studio_assets" ADD CONSTRAINT "studio_assets_post_id_studio_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."studio_posts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
