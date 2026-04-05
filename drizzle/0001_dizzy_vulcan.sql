CREATE TYPE "public"."sales_after_sales_status" AS ENUM('none', 'partial_refund', 'refunded', 'returned', 'chargeback');--> statement-breakpoint
CREATE TYPE "public"."sales_order_item_product_type" AS ENUM('subscription', 'credit_package');--> statement-breakpoint
CREATE TYPE "public"."sales_order_provider" AS ENUM('creem', 'wechat_pay', 'alipay');--> statement-breakpoint
CREATE TYPE "public"."sales_order_status" AS ENUM('pending', 'paid', 'confirmed', 'closed');--> statement-breakpoint
CREATE TYPE "public"."sales_order_type" AS ENUM('subscription', 'credit_purchase');--> statement-breakpoint
ALTER TYPE "public"."credits_transaction_type" ADD VALUE 'admin_grant' BEFORE 'expiration';--> statement-breakpoint
CREATE TABLE "sales_order" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" "sales_order_provider" NOT NULL,
	"provider_order_id" text,
	"provider_checkout_id" text,
	"provider_subscription_id" text,
	"provider_payment_id" text,
	"order_type" "sales_order_type" NOT NULL,
	"status" "sales_order_status" DEFAULT 'paid' NOT NULL,
	"after_sales_status" "sales_after_sales_status" DEFAULT 'none' NOT NULL,
	"currency" text NOT NULL,
	"gross_amount" integer DEFAULT 0 NOT NULL,
	"paid_at" timestamp,
	"event_time" timestamp NOT NULL,
	"event_type" text NOT NULL,
	"event_idempotency_key" text NOT NULL,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sales_order_event_idempotency_key_unique" UNIQUE("event_idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "sales_order_item" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_type" "sales_order_item_product_type" NOT NULL,
	"product_id" text,
	"price_id" text,
	"plan_id" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"gross_amount" integer DEFAULT 0 NOT NULL,
	"net_amount" integer DEFAULT 0 NOT NULL,
	"commission_base_amount" integer DEFAULT 0 NOT NULL,
	"refunded_amount" integer DEFAULT 0 NOT NULL,
	"refundable_amount" integer DEFAULT 0 NOT NULL,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_item" ADD CONSTRAINT "sales_order_item_order_id_sales_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE cascade ON UPDATE no action;