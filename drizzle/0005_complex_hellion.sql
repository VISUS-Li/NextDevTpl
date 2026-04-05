CREATE TYPE "public"."commission_calculation_mode" AS ENUM('rate', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."commission_event_status" AS ENUM('pending', 'completed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."commission_ledger_direction" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TYPE "public"."commission_ledger_entry_type" AS ENUM('commission_frozen', 'commission_available', 'commission_reverse', 'withdraw_freeze', 'withdraw_release', 'withdraw_paid', 'manual_adjustment');--> statement-breakpoint
CREATE TYPE "public"."commission_record_status" AS ENUM('frozen', 'available', 'reversed', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."commission_rule_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "commission_balance" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"currency" text NOT NULL,
	"total_earned" integer DEFAULT 0 NOT NULL,
	"available_amount" integer DEFAULT 0 NOT NULL,
	"frozen_amount" integer DEFAULT 0 NOT NULL,
	"withdrawn_amount" integer DEFAULT 0 NOT NULL,
	"reversed_amount" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "commission_balance_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "commission_event" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"order_item_id" text NOT NULL,
	"trigger_user_id" text NOT NULL,
	"trigger_type" text NOT NULL,
	"status" "commission_event_status" DEFAULT 'pending' NOT NULL,
	"currency" text NOT NULL,
	"commission_base_amount" integer DEFAULT 0 NOT NULL,
	"settlement_basis" text,
	"rule_snapshot" json,
	"attribution_snapshot" json,
	"error_message" text,
	"executed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"record_id" text,
	"entry_type" "commission_ledger_entry_type" NOT NULL,
	"direction" "commission_ledger_direction" NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"before_balance" integer DEFAULT 0 NOT NULL,
	"after_balance" integer DEFAULT 0 NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"memo" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_record" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"beneficiary_user_id" text NOT NULL,
	"source_agent_user_id" text,
	"commission_level" integer DEFAULT 1 NOT NULL,
	"rule_id" text,
	"rule_snapshot" json,
	"amount" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"status" "commission_record_status" DEFAULT 'frozen' NOT NULL,
	"available_at" timestamp,
	"reversed_at" timestamp,
	"reversal_reason" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"status" "commission_rule_status" DEFAULT 'active' NOT NULL,
	"order_type" "sales_order_type",
	"product_type" "sales_order_item_product_type",
	"commission_level" integer DEFAULT 1 NOT NULL,
	"calculation_mode" "commission_calculation_mode" DEFAULT 'rate' NOT NULL,
	"rate" integer,
	"fixed_amount" integer,
	"freeze_days" integer DEFAULT 7 NOT NULL,
	"applies_to_first_purchase" boolean DEFAULT true NOT NULL,
	"applies_to_renewal" boolean DEFAULT false NOT NULL,
	"applies_to_credit_package" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commission_balance" ADD CONSTRAINT "commission_balance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_event" ADD CONSTRAINT "commission_event_order_id_sales_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_event" ADD CONSTRAINT "commission_event_order_item_id_sales_order_item_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."sales_order_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_event" ADD CONSTRAINT "commission_event_trigger_user_id_user_id_fk" FOREIGN KEY ("trigger_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_record_id_commission_record_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."commission_record"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_record" ADD CONSTRAINT "commission_record_event_id_commission_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."commission_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_record" ADD CONSTRAINT "commission_record_beneficiary_user_id_user_id_fk" FOREIGN KEY ("beneficiary_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_record" ADD CONSTRAINT "commission_record_source_agent_user_id_user_id_fk" FOREIGN KEY ("source_agent_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_record" ADD CONSTRAINT "commission_record_rule_id_commission_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."commission_rule"("id") ON DELETE set null ON UPDATE no action;