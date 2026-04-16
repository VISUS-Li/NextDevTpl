ALTER TABLE "sales_order" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "sales_order" ADD COLUMN "attributed_agent_user_id" text;--> statement-breakpoint
ALTER TABLE "sales_order" ADD COLUMN "attribution_id" text;--> statement-breakpoint
ALTER TABLE "sales_order" ADD COLUMN "attribution_snapshot" json;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_attributed_agent_user_id_user_id_fk" FOREIGN KEY ("attributed_agent_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;