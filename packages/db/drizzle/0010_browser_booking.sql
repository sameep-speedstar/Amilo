CREATE TABLE IF NOT EXISTS "browser_profiles" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "status" varchar(20) NOT NULL DEFAULT 'idle',
  "storage_path" text,
  "last_active_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "browser_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "merchant" varchar(40) NOT NULL,
  "vertical" varchar(40) NOT NULL,
  "status" varchar(40) NOT NULL DEFAULT 'queued',
  "intent" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "result" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error" text,
  "pending_kind" varchar(40),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "browser_jobs_user_status_idx" ON "browser_jobs" ("user_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "browser_jobs_created_idx" ON "browser_jobs" ("created_at");
