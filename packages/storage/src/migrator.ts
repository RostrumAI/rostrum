import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Kysely } from "kysely";
// Type-only dependency: the provider wraps migration modules it discovers
// at runtime and never calls their functions itself.
import type { Migration, MigrationProvider, MigrationResult } from "kysely/migration";
import { Migrator } from "kysely/migration";

/**
 * Migration provider over TypeScript migration modules.
 *
 * Each migration is one `NNN_name.ts` file in `migrationFolder` exporting
 * an `up` and a `down` function that receive the Kysely instance. Files
 * run in filename order, so the numeric prefix defines the sequence.
 * Because migrations are TypeScript modules, they typecheck their queries
 * against the schema types they import — data backfills and row updates
 * fail `tsc` when they do not match the declared tables.
 */
export class TsFileMigrationProvider implements MigrationProvider {
    private readonly migrationFolder: string;

    /** Constructs a provider that loads every `.ts` file in `migrationFolder`. */
    constructor(migrationFolder: string) {
        this.migrationFolder = migrationFolder;
    }

    async getMigrations(): Promise<Record<string, Migration>> {
        const files = (await readdir(this.migrationFolder))
            .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"))
            .sort();
        const migrations: Record<string, Migration> = {};
        for (const file of files) {
            const name = file.replace(/\.ts$/, "");
            // Dynamic import is the mechanism, not a style choice: the
            // module names come from readdir at runtime, so no static
            // specifier can name them. Bun executes TypeScript modules
            // directly, which keeps migrations build-free.
            const module = (await import(
                pathToFileURL(join(this.migrationFolder, file)).href
            )) as Record<string, unknown>;
            if (typeof module.up !== "function" || typeof module.down !== "function") {
                throw new Error(`Migration ${name} must export 'up' and 'down' functions`);
            }
            migrations[name] = {
                up: module.up as Migration["up"],
                down: module.down as Migration["down"],
            };
        }
        return migrations;
    }
}

/**
 * Applies every pending migration to the latest state. Safe to rerun:
 * applied migrations are recorded in the database and skipped.
 * Returns the per-migration results of this run.
 *
 * The migration folder is the caller's — each application owns its own
 * migration files next to its schema types.
 */
export async function migrateToLatest<DB>(
    db: Kysely<DB>,
    migrationFolder: string,
): Promise<MigrationResult[]> {
    const migrator = new Migrator({
        db,
        provider: new TsFileMigrationProvider(migrationFolder),
    });
    const { error, results } = await migrator.migrateToLatest();
    if (error) {
        throw error instanceof Error ? error : new Error(String(error));
    }
    return results ?? [];
}
