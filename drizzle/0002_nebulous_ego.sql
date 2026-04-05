CREATE TYPE "public"."distribution_profile_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."distribution_referral_code_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "distribution_attribution" (
	"id" text PRIMARY KEY NOT NULL,
	"visitor_key" text,
	"user_id" text,
	"agent_user_id" text NOT NULL,
	"referral_code" text NOT NULL,
	"campaign" text,
	"landing_path" text,
	"source" text,
	"bound_reason" text,
	"bound_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"snapshot" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "distribution_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" "distribution_profile_status" DEFAULT 'active' NOT NULL,
	"agent_level" text,
	"display_name" text,
	"inviter_user_id" text,
	"path" text,
	"depth" integer DEFAULT 0 NOT NULL,
	"bound_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "distribution_profile_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "distribution_referral_code" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_user_id" text NOT NULL,
	"code" text NOT NULL,
	"campaign" text,
	"landing_path" text,
	"status" "distribution_referral_code_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "distribution_referral_code_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "distribution_attribution" ADD CONSTRAINT "distribution_attribution_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_attribution" ADD CONSTRAINT "distribution_attribution_agent_user_id_user_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_profile" ADD CONSTRAINT "distribution_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_profile" ADD CONSTRAINT "distribution_profile_inviter_user_id_user_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_referral_code" ADD CONSTRAINT "distribution_referral_code_agent_user_id_user_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;