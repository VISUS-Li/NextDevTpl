CREATE TYPE "public"."sales_after_sales_event_type" AS ENUM('partial_refund', 'refunded', 'returned', 'chargeback');--> statement-breakpoint
CREATE TABLE "sales_after_sales_event" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"order_item_id" text,
	"event_type" "sales_after_sales_event_type" NOT NULL,
	"event_idempotency_key" text NOT NULL,
	"provider_event_id" text,
	"amount" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"reason" text,
	"event_time" timestamp NOT NULL,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sales_after_sales_event_event_idempotency_key_unique" UNIQUE("event_idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "sales_after_sales_event" ADD CONSTRAINT "sales_after_sales_event_order_id_sales_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_after_sales_event" ADD CONSTRAINT "sales_after_sales_event_order_item_id_sales_order_item_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."sales_order_item"("id") ON DELETE set null ON UPDATE no action;