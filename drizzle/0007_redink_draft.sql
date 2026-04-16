CREATE TABLE "redink_draft" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"product_info" json NOT NULL,
	"source_asset" json,
	"selected_title" text NOT NULL,
	"selected_copywriting" text NOT NULL,
	"tags" json NOT NULL,
	"image_prompt" text NOT NULL,
	"selected_images" json NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"publish_result" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "redink_draft" ADD CONSTRAINT "redink_draft_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;