CREATE TABLE "tool_storage_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"tool_key" text NOT NULL,
	"purpose" text NOT NULL,
	"prefix" text NOT NULL,
	"retention_class" "storage_retention_class" DEFAULT 'long_term' NOT NULL,
	"ttl_hours" integer,
	"max_size_bytes" integer,
	"content_types" json,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tool_storage_rule" ADD CONSTRAINT "tool_storage_rule_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tool_storage_rule_project_tool_purpose_idx" ON "tool_storage_rule" USING btree ("project_id","tool_key","purpose");