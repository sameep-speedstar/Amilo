CREATE TABLE "context_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"rel" varchar(80) NOT NULL,
	"attrs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" integer DEFAULT 80 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"label" varchar(320) NOT NULL,
	"attrs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" integer DEFAULT 80 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_message_id" varchar(200),
	"claim" text NOT NULL,
	"linked_node_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"linked_edge_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "context_edges" ADD CONSTRAINT "context_edges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_edges" ADD CONSTRAINT "context_edges_from_node_id_context_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."context_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_edges" ADD CONSTRAINT "context_edges_to_node_id_context_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."context_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_nodes" ADD CONSTRAINT "context_nodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_observations" ADD CONSTRAINT "context_observations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "context_edges_user_from_to_rel_uidx" ON "context_edges" USING btree ("user_id","from_node_id","to_node_id","rel");--> statement-breakpoint
CREATE UNIQUE INDEX "context_nodes_user_kind_label_uidx" ON "context_nodes" USING btree ("user_id","kind","label");