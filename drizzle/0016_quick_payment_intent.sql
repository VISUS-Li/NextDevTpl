CREATE TYPE "public"."payment_intent_status" AS ENUM('created', 'pending', 'paid', 'closed', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_intent_biz_type" AS ENUM('credit_purchase');--> statement-breakpoint
CREATE TYPE "public"."payment_intent_display_mode" AS ENUM('redirect', 'qrcode');--> statement-breakpoint

CREATE TABLE "payment_intent" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" "sales_order_provider" NOT NULL,
	"biz_type" "payment_intent_biz_type" NOT NULL,
	"status" "payment_intent_status" DEFAULT 'created' NOT NULL,
	"display_mode" "payment_intent_display_mode" DEFAULT 'redirect' NOT NULL,
	"package_id" text NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"subject" text NOT NULL,
	"out_trade_no" text NOT NULL,
	"provider_order_id" text,
	"provider_checkout_id" text,
	"provider_payment_id" text,
	"checkout_url" text,
	"qr_code_url" text,
	"metadata" json,
	"provider_response" json,
	"expires_at" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "payment_intent" ADD CONSTRAINT "payment_intent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intent_out_trade_no_idx" ON "payment_intent" USING btree ("out_trade_no");--> statement-breakpoint
