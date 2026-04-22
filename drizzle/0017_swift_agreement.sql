CREATE TYPE "public"."subscription_contract_status" AS ENUM('pending_sign', 'active', 'paused', 'terminated', 'failed');--> statement-breakpoint
CREATE TYPE "public"."subscription_billing_status" AS ENUM('scheduled', 'processing', 'paid', 'failed', 'refunded', 'closed');--> statement-breakpoint
CREATE TABLE "subscription_contract" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subscription_record_id" text,
	"provider" "sales_order_provider" NOT NULL,
	"plan_id" text NOT NULL,
	"price_id" text NOT NULL,
	"billing_interval" text NOT NULL,
	"currency" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"provider_contract_id" text,
	"provider_plan_id" text,
	"provider_external_user_id" text,
	"signing_url" text,
	"status" "subscription_contract_status" DEFAULT 'pending_sign' NOT NULL,
	"signed_at" timestamp,
	"terminated_at" timestamp,
	"next_billing_at" timestamp,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "subscription_billing" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"user_id" text NOT NULL,
	"subscription_record_id" text,
	"provider" "sales_order_provider" NOT NULL,
	"plan_id" text NOT NULL,
	"price_id" text NOT NULL,
	"billing_sequence" integer DEFAULT 1 NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"out_trade_no" text NOT NULL,
	"provider_order_id" text,
	"provider_payment_id" text,
	"status" "subscription_billing_status" DEFAULT 'scheduled' NOT NULL,
	"paid_at" timestamp,
	"failed_at" timestamp,
	"failure_reason" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_billing_out_trade_no_unique" UNIQUE("out_trade_no")
);--> statement-breakpoint
ALTER TABLE "subscription_contract" ADD CONSTRAINT "subscription_contract_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_contract" ADD CONSTRAINT "subscription_contract_subscription_record_id_subscription_id_fk" FOREIGN KEY ("subscription_record_id") REFERENCES "public"."subscription"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_billing" ADD CONSTRAINT "subscription_billing_contract_id_subscription_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."subscription_contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_billing" ADD CONSTRAINT "subscription_billing_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_billing" ADD CONSTRAINT "subscription_billing_subscription_record_id_subscription_id_fk" FOREIGN KEY ("subscription_record_id") REFERENCES "public"."subscription"("id") ON DELETE set null ON UPDATE no action;
