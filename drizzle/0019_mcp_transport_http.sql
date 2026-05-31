DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'mcp_transport_type' AND e.enumlabel = 'sse'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'mcp_transport_type' AND e.enumlabel = 'http'
    ) THEN
        ALTER TYPE "public"."mcp_transport_type" RENAME VALUE 'sse' TO 'http';
    END IF;
END $$;
