import { sql } from 'drizzle-orm';
import { db } from '.';
import { EMBEDDED_MAINTENANCE_MIGRATIONS, IS_COMPILED_BINARY } from '../embedded-assets';
import { createChildLogger } from '../logger';
import { getMigrationsFolder } from '../utils';

const log = createChildLogger({ component: 'db-maintenance' });

type MaintenanceMigration = { sql: string; tag: string };

async function readMaintenanceMigrations(): Promise<MaintenanceMigration[]> {
    if (IS_COMPILED_BINARY) {
        return EMBEDDED_MAINTENANCE_MIGRATIONS;
    }

    const maintenanceFolder = `${getMigrationsFolder()}/maintenance`;
    const journalPath = `${maintenanceFolder}/_journal.json`;
    const journalFile = Bun.file(journalPath);

    if (!await journalFile.exists()) {
        return [];
    }

    const journal = await journalFile.json();
    if (!journal?.entries || !Array.isArray(journal.entries)) {
        throw new Error(`Invalid maintenance migration journal at ${journalPath}`);
    }

    const migrations: MaintenanceMigration[] = [];
    for (const entry of journal.entries) {
        const migrationPath = `${maintenanceFolder}/${entry.tag}.sql`;
        const sqlText = await Bun.file(migrationPath).text();
        migrations.push({ tag: entry.tag, sql: sqlText });
    }

    return migrations;
}

async function ensureMaintenanceTable() {
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_maintenance (
            key text PRIMARY KEY,
            completed_at timestamp DEFAULT now() NOT NULL
        )
    `);
}

async function hasMaintenanceMarker(key: string): Promise<boolean> {
    const result = await db.execute(sql`
        SELECT EXISTS (
            SELECT 1
            FROM app_maintenance
            WHERE key = ${key}
        ) AS exists
    `);
    return Boolean((result.rows[0] as { exists?: boolean } | undefined)?.exists);
}

async function markMaintenanceComplete(key: string): Promise<void> {
    await db.execute(sql`
        INSERT INTO app_maintenance (key, completed_at)
        VALUES (${key}, now())
        ON CONFLICT (key) DO UPDATE SET completed_at = excluded.completed_at
    `);
}

export async function runMaintenanceMigrations() {
    const migrations = await readMaintenanceMigrations();
    if (migrations.length === 0) {
        return;
    }

    await ensureMaintenanceTable();

    for (const migration of migrations) {
        if (await hasMaintenanceMarker(migration.tag)) {
            continue;
        }

        log.info({ migration: migration.tag }, 'Running maintenance migration');
        try {
            const statements = migration.sql.split('--> statement-breakpoint');
            for (const statement of statements) {
                const trimmed = statement.trim();
                if (trimmed) {
                    await db.execute(sql.raw(trimmed));
                }
            }
            await markMaintenanceComplete(migration.tag);
            log.info({ migration: migration.tag }, 'Maintenance migration complete');
        } catch (error) {
            log.warn({ err: error, migration: migration.tag }, 'Maintenance migration failed; will retry on a future launch.');
        }
    }
}
