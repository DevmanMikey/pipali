DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mcp_auth_type') THEN
        CREATE TYPE "public"."mcp_auth_type" AS ENUM('none', 'bearer', 'oauth');
    END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mcp_oauth_status') THEN
        CREATE TYPE "public"."mcp_oauth_status" AS ENUM('not_connected', 'auth_pending', 'connected', 'auth_required', 'error');
    END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "mcp_server" ADD COLUMN IF NOT EXISTS "auth_type" "mcp_auth_type" DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE "mcp_server" ADD COLUMN IF NOT EXISTS "oauth_status" "mcp_oauth_status" DEFAULT 'not_connected' NOT NULL;
--> statement-breakpoint
UPDATE "mcp_server"
SET "auth_type" = CASE
    WHEN "api_key" IS NOT NULL AND "api_key" <> '' THEN 'bearer'::"mcp_auth_type"
    ELSE 'none'::"mcp_auth_type"
END
WHERE "auth_type" = 'none'::"mcp_auth_type";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_oauth_state" (
    "id" serial PRIMARY KEY NOT NULL,
    "server_id" integer NOT NULL,
    "authorization_server_url" text,
    "resource_url" text,
    "scope" text,
    "state" text,
    "code_verifier" text,
    "client_information" jsonb,
    "tokens" jsonb,
    "last_authorization_url" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_oauth_state_server_id_mcp_server_id_fk') THEN
        ALTER TABLE "mcp_oauth_state" ADD CONSTRAINT "mcp_oauth_state_server_id_mcp_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_server"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_oauth_state_server_id_unique" ON "mcp_oauth_state" USING btree ("server_id");
