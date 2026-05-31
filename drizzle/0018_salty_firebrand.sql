CREATE TABLE "conversation_step" (
	"conversation_id" uuid NOT NULL,
	"step_id" integer NOT NULL,
	"source" text NOT NULL,
	"timestamp" timestamp NOT NULL,
	"message_preview" text,
	"step" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_step_conversation_id_step_id_pk" PRIMARY KEY("conversation_id","step_id")
);
--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "schema_version" text DEFAULT 'ATIF-v1.4' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "agent" jsonb;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "final_metrics" jsonb;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "extra" jsonb;--> statement-breakpoint
INSERT INTO "conversation_step" (
	"conversation_id",
	"step_id",
	"source",
	"timestamp",
	"message_preview",
	"step",
	"created_at",
	"updated_at"
)
SELECT
	"conversation"."id",
	(step_value->>'step_id')::integer,
	COALESCE(step_value->>'source', 'user'),
	CASE
		WHEN step_value ? 'timestamp' THEN (step_value->>'timestamp')::timestamp
		ELSE "conversation"."created_at"
	END,
	left(COALESCE(step_value->>'message', ''), 240),
	step_value,
	"conversation"."created_at",
	"conversation"."updated_at"
FROM "conversation",
	jsonb_array_elements(COALESCE("conversation"."trajectory"->'steps', '[]'::jsonb)) AS step_value
WHERE step_value ? 'step_id'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "conversation"
SET
	"schema_version" = COALESCE("trajectory"->>'schema_version', 'ATIF-v1.4'),
	"session_id" = COALESCE("trajectory"->>'session_id', "id"::text),
	"agent" = COALESCE("trajectory"->'agent', '{"name":"pipali-agent","version":"1.0.0","model_name":"unknown"}'::jsonb),
	"final_metrics" = "trajectory"->'final_metrics',
	"extra" = "trajectory"->'extra';
--> statement-breakpoint
ALTER TABLE "conversation" ALTER COLUMN "session_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ALTER COLUMN "agent" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_step" ADD CONSTRAINT "conversation_step_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_step_conversation_id_idx" ON "conversation_step" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_step_source_idx" ON "conversation_step" USING btree ("source");--> statement-breakpoint
ALTER TABLE "conversation" DROP COLUMN "trajectory";
