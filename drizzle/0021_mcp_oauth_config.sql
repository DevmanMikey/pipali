ALTER TABLE "mcp_server" ADD COLUMN IF NOT EXISTS "oauth_client_id" text;
--> statement-breakpoint
ALTER TABLE "mcp_server" ADD COLUMN IF NOT EXISTS "oauth_client_secret" text;
--> statement-breakpoint
ALTER TABLE "mcp_server" ADD COLUMN IF NOT EXISTS "oauth_scopes" jsonb;
--> statement-breakpoint
ALTER TABLE "mcp_oauth_state" ADD COLUMN IF NOT EXISTS "resource_metadata_url" text;
