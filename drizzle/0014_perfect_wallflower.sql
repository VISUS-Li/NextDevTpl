CREATE TABLE "tool_definition_import_log" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"tool_key" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" text,
	"previous_definition_json" json,
	"next_definition_json" json,
	"summary_json" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tool_definition_import_log" ADD CONSTRAINT "tool_definition_import_log_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_definition_import_log" ADD CONSTRAINT "tool_definition_import_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;