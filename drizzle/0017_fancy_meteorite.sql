CREATE TYPE "public"."chat_model_tier" AS ENUM('flagship', 'balanced', 'lite');--> statement-breakpoint
ALTER TABLE "chat_model" ADD COLUMN "tier" "chat_model_tier";--> statement-breakpoint
ALTER TABLE "chat_model" ADD COLUMN "tagline" text;--> statement-breakpoint
ALTER TABLE "chat_model" ADD COLUMN "cost_tier" text;--> statement-breakpoint
ALTER TABLE "chat_model" ADD COLUMN "recommended" boolean DEFAULT false NOT NULL;