CREATE TYPE "public"."tool_config_audit_action" AS ENUM('create', 'update', 'clear');--> statement-breakpoint
CREATE TYPE "public"."tool_config_field_type" AS ENUM('string', 'textarea', 'number', 'boolean', 'select', 'json', 'secret');--> statement-breakpoint
CREATE TYPE "public"."tool_config_scope" AS ENUM('project_admin', 'user');--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"config_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "tool_config_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"tool_key" text NOT NULL,
	"field_key" text NOT NULL,
	"scope" "tool_config_scope" NOT NULL,
	"user_id" text,
	"actor_id" text,
	"action" "tool_config_audit_action" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_config_field" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"tool_key" text NOT NULL,
	"field_key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"group" text DEFAULT 'tool' NOT NULL,
	"type" "tool_config_field_type" NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"admin_only" boolean DEFAULT false NOT NULL,
	"user_overridable" boolean DEFAULT false NOT NULL,
	"default_value_json" json,
	"options_json" json,
	"validation_json" json,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_config_value" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"tool_key" text NOT NULL,
	"field_key" text NOT NULL,
	"scope" "tool_config_scope" NOT NULL,
	"user_id" text,
	"value_json" json,
	"encrypted_value" text,
	"secret_set" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"tool_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tool_config_audit_log" ADD CONSTRAINT "tool_config_audit_log_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_config_audit_log" ADD CONSTRAINT "tool_config_audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_config_audit_log" ADD CONSTRAINT "tool_config_audit_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_config_field" ADD CONSTRAINT "tool_config_field_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_config_value" ADD CONSTRAINT "tool_config_value_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_config_value" ADD CONSTRAINT "tool_config_value_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_config_value" ADD CONSTRAINT "tool_config_value_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_registry" ADD CONSTRAINT "tool_registry_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tool_config_field_project_tool_field_idx" ON "tool_config_field" USING btree ("project_id","tool_key","field_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_config_value_project_admin_idx" ON "tool_config_value" USING btree ("project_id","tool_key","field_key","scope") WHERE "tool_config_value"."scope" = 'project_admin';--> statement-breakpoint
CREATE UNIQUE INDEX "tool_config_value_user_idx" ON "tool_config_value" USING btree ("project_id","tool_key","field_key","scope","user_id") WHERE "tool_config_value"."scope" = 'user';--> statement-breakpoint
CREATE UNIQUE INDEX "tool_registry_project_tool_key_idx" ON "tool_registry" USING btree ("project_id","tool_key");