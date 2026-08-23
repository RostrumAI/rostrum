import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Kysely, sql } from "kysely";
import {
    type Migration,
    type MigrationProvider,
    type MigrationResult,
    Migrator,
} from "kysely/migration";
import type { WorkflowDatabase } from "./database";
import { StorageError } from "./errors";

/**
 * Migration provider over plain SQL files.
 *
 * Each migration is one `NNN_name.sql` file containing an `-- UP` and a
 * `-- DOWN` section; the section marker line ends the other section. SQL
 * is the migration source of truth per E1-S0, so no TypeScript migration
 * files exist. Statements within a section run as one script through the
 * driver's simple query protocol.
 */
export class SqlFileMigrationProvider implements MigrationProvider {
    private readonly migrationFolder: string;

    /** Constructs a provider that reads every `.sql` file in `migrationFolder`. */
    constructor(migrationFolder: string) {
        this.migrationFolder = migrationFolder;
    }

    async getMigrations(): Promise<Record<string, Migration>> {
        const files = (await readdir(this.migrationFolder))
            .filter((file) => file.endsWith(".sql"))
            .sort();
        const migrations: Record<string, Migration> = {};
        for (const file of files) {
            const name = file.replace(/\.sql$/, "");
            const text = await readFile(join(this.migrationFolder, file), "utf8");
            migrations[name] = {
                up: (db) => runSection(db, name, text, "UP"),
                down: (db) => runSection(db, name, text, "DOWN"),
            };
        }
        return migrations;
    }
}

/**
 * Applies every pending migration to the latest state. Safe to rerun:
 * applied migrations are recorded in the database and skipped.
 * Returns the per-migration results of this run.
 */
export async function migrateToLatest(
    db: Kysely<WorkflowDatabase>,
    migrationFolder: string = defaultMigrationFolder(),
): Promise<MigrationResult[]> {
    const migrator = new Migrator({ db, provider: new SqlFileMigrationProvider(migrationFolder) });
    const { error, results } = await migrator.migrateToLatest();
    if (error) {
        throw error instanceof Error ? error : new StorageError(String(error));
    }
    return results ?? [];
}

async function runSection(
    db: Kysely<WorkflowDatabase>,
    migration: string,
    text: string,
    section: "UP" | "DOWN",
): Promise<void> {
    const body = extractSection(migration, text, section);
    await sql.raw(body).execute(db);
}

function extractSection(migration: string, text: string, section: "UP" | "DOWN"): string {
    const own = new RegExp(`^-- ${section}\\b.*$`, "m").exec(text);
    if (!own?.[0]) {
        throw new StorageError(`Migration ${migration} has no ${section} section`);
    }
    const start = own.index + own[0].length;
    const other = new RegExp(`^-- ${section === "UP" ? "DOWN" : "UP"}\\b.*$`, "m");
    const stop = other.exec(text.slice(start));
    const end = stop?.index === undefined ? text.length : start + stop.index;
    return text.slice(start, end).trim();
}

function defaultMigrationFolder(): string {
    // src/migrator.ts -> packages/storage/migrations
    return join(import.meta.dir, "..", "migrations");
}
