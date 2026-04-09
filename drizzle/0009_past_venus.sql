CREATE TYPE "public"."ai_billing_mode" AS ENUM('fixed_credits', 'token_based', 'cost_plus');--> statement-breakpoint
CREATE TYPE "public"."ai_billing_record_status" AS ENUM('charged', 'skipped', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."ai_relay_cost_mode" AS ENUM('manual', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."ai_relay_provider_health_status" AS ENUM('unknown', 'healthy', 'degraded', 'down');--> statement-breakpoint
CREATE TYPE "public"."ai_relay_provider_type" AS ENUM('openai_compatible');--> statement-breakpoint
CREATE TYPE "public"."ai_request_attempt_status" AS ENUM('success', 'failed', 'timeout', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."ai_request_status" AS ENUM('pending', 'success', 'failed', 'insufficient_credits', 'billing_failed');--> statement-breakpoint
CREATE TYPE "public"."ai_request_type" AS ENUM('chat');--> statement-breakpoint
CREATE TYPE "public"."ai_route_strategy" AS ENUM('primary_only', 'priority_failover', 'weighted');--> statement-breakpoint
CREATE TYPE "public"."storage_object_status" AS ENUM('pending', 'ready', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."storage_retention_class" AS ENUM('permanent', 'long_term', 'temporary', 'ephemeral');--> statement-breakpoint
CREATE TABLE "ai_billing_record" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"user_id" text NOT NULL,
	"billing_mode" "ai_billing_mode" NOT NULL,
	"charged_credits" integer DEFAULT 0 NOT NULL,
	"credits_transaction_id" text,
	"status" "ai_billing_record_status" DEFAULT 'charged' NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_pricing_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"tool_key" text NOT NULL,
	"feature_key" text NOT NULL,
	"request_type" "ai_request_type" DEFAULT 'chat' NOT NULL,
	"billing_mode" "ai_billing_mode" NOT NULL,
	"model_scope" text DEFAULT 'any' NOT NULL,
	"fixed_credits" integer,
	"input_tokens_per_credit" integer,
	"output_tokens_per_credit" integer,
	"cost_usd_per_credit_micros" integer,
	"minimum_credits" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_relay_model_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"model_key" text NOT NULL,
	"model_alias" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"weight" integer DEFAULT 100 NOT NULL,
	"cost_mode" "ai_relay_cost_mode" DEFAULT 'manual' NOT NULL,
	"input_cost_per_1k_micros" integer DEFAULT 0 NOT NULL,
	"output_cost_per_1k_micros" integer DEFAULT 0 NOT NULL,
	"fixed_cost_micros" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 0 NOT NULL,
	"timeout_ms" integer DEFAULT 30000 NOT NULL,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_relay_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"provider_type" "ai_relay_provider_type" DEFAULT 'openai_compatible' NOT NULL,
	"base_url" text NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"weight" integer DEFAULT 100 NOT NULL,
	"request_type" "ai_request_type" DEFAULT 'chat' NOT NULL,
	"metadata" json,
	"last_health_at" timestamp,
	"last_health_status" "ai_relay_provider_health_status" DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_relay_provider_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "ai_request_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"attempt_no" integer NOT NULL,
	"provider_id" text,
	"provider_key" text NOT NULL,
	"model_key" text NOT NULL,
	"model_alias" text NOT NULL,
	"status" "ai_request_attempt_status" NOT NULL,
	"http_status" integer,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"provider_cost_micros" integer,
	"latency_ms" integer,
	"error_code" text,
	"error_message" text,
	"request_meta" json,
	"response_meta" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_request_log" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tool_key" text NOT NULL,
	"feature_key" text NOT NULL,
	"request_type" "ai_request_type" DEFAULT 'chat' NOT NULL,
	"requested_model" text,
	"resolved_model" text,
	"route_strategy" "ai_route_strategy" DEFAULT 'priority_failover' NOT NULL,
	"status" "ai_request_status" DEFAULT 'pending' NOT NULL,
	"billing_mode" "ai_billing_mode" NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"provider_cost_micros" integer,
	"charged_credits" integer,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"winning_attempt_no" integer,
	"latency_ms" integer,
	"error_code" text,
	"error_message" text,
	"request_body" json,
	"response_meta" json,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_request_log_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "storage_object" (
	"id" text PRIMARY KEY NOT NULL,
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer,
	"owner_user_id" text,
	"tool_key" text,
	"purpose" text NOT NULL,
	"retention_class" "storage_retention_class" DEFAULT 'long_term' NOT NULL,
	"expires_at" timestamp,
	"request_id" text,
	"task_id" text,
	"status" "storage_object_status" DEFAULT 'pending' NOT NULL,
	"metadata" json,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tool_config_audit_log" DROP CONSTRAINT "tool_config_audit_log_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tool_config_audit_log" DROP CONSTRAINT "tool_config_audit_log_actor_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tool_config_value" DROP CONSTRAINT "tool_config_value_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "tool_config_value" DROP CONSTRAINT "tool_config_value_updated_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_billing_record" ADD CONSTRAINT "ai_billing_record_request_id_ai_request_log_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ai_request_log"("request_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_billing_record" ADD CONSTRAINT "ai_billing_record_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_billing_record" ADD CONSTRAINT "ai_billing_record_credits_transaction_id_credits_transaction_id_fk" FOREIGN KEY ("credits_transaction_id") REFERENCES "public"."credits_transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_relay_model_binding" ADD CONSTRAINT "ai_relay_model_binding_provider_id_ai_relay_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_relay_provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_request_attempt" ADD CONSTRAINT "ai_request_attempt_request_id_ai_request_log_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ai_request_log"("request_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_request_attempt" ADD CONSTRAINT "ai_request_attempt_provider_id_ai_relay_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_relay_provider"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_request_log" ADD CONSTRAINT "ai_request_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_object" ADD CONSTRAINT "storage_object_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_pricing_rule_tool_feature_request_idx" ON "ai_pricing_rule" USING btree ("tool_key","feature_key","request_type","model_scope");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_relay_model_binding_provider_model_idx" ON "ai_relay_model_binding" USING btree ("provider_id","model_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_request_attempt_request_attempt_idx" ON "ai_request_attempt" USING btree ("request_id","attempt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_object_bucket_key_idx" ON "storage_object" USING btree ("bucket","key");