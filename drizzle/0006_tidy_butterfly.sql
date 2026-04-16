CREATE TYPE "public"."withdrawal_request_status" AS ENUM('pending', 'approved', 'rejected', 'paid', 'failed');--> statement-breakpoint
CREATE TABLE "withdrawal_request" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"fee_amount" integer DEFAULT 0 NOT NULL,
	"net_amount" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"status" "withdrawal_request_status" DEFAULT 'pending' NOT NULL,
	"payee_snapshot" json,
	"operator_user_id" text,
	"operator_note" text,
	"reviewed_at" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;