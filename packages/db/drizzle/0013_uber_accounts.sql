CREATE TABLE IF NOT EXISTS "uber_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "uber_user_id" varchar(80),
  "scopes" text DEFAULT '' NOT NULL,
  "access_token_enc" text NOT NULL,
  "refresh_token_enc" text DEFAULT '' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uber_accounts_user_uidx" ON "uber_accounts" ("user_id");
