CREATE TABLE "tool_feature" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"tool_key" text NOT NULL,
	"feature_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"request_type" "ai_request_type" DEFAULT 'chat' NOT NULL,
	"default_operation" text,
	"required_capabilities" json,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tool_feature" ADD CONSTRAINT "tool_feature_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tool_feature_project_tool_feature_idx" ON "tool_feature" USING btree ("project_id","tool_key","feature_key");