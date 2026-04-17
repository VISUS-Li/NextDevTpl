CREATE TABLE "tool_launch_ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"tool_key" text NOT NULL,
	"user_id" text NOT NULL,
	"ticket_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_runtime_token" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"tool_key" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" json NOT NULL,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tool_launch_ticket" ADD CONSTRAINT "tool_launch_ticket_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_launch_ticket" ADD CONSTRAINT "tool_launch_ticket_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_runtime_token" ADD CONSTRAINT "tool_runtime_token_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tool_launch_ticket_hash_idx" ON "tool_launch_ticket" USING btree ("ticket_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_runtime_token_project_tool_name_idx" ON "tool_runtime_token" USING btree ("project_id","tool_key","name");