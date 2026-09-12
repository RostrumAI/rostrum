/** @fileoverview Database migration behavior tests. */

import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type Kysely, sql } from "kysely";
import { Migrator, NO_MIGRATIONS } from "kysely/migration";
import { createDatabase } from "./client";
import { migrateToLatest, TsFileMigrationProvider } from "./migrator";
import type { Database } from "./schema/database";
import { startTestPostgres } from "./testing/postgres";

const testPostgres = await startTestPostgres();
afterAll(() => testPostgres.stop());

/** The migration modules under test, resolved beside this package. */
const migrationsFolder = join(import.meta.dir, "..", "migrations");

const EXPECTED_MIGRATIONS = [
    "001_workflows",
    "002_revisions",
    "003_published_versions",
    "004_revision_type",
    "005_publications",
];

async function withDatabase<T>(run: (db: Kysely<Database>) => Promise<T>): Promise<T> {
    const handle = createDatabase(testPostgres.options);
    const db = handle.db;
    try {
        return await run(db);
    } finally {
        await handle.close({ timeoutMs: 1_000 });
    }
}

async function workflowTables(db: Kysely<Database>): Promise<string[]> {
    const result = await sql<{
        tableName: string;
    }>`select table_name as "tableName" from information_schema.tables where table_schema = 'public'
            and table_name in ('workflows', 'revisions', 'publications')`.execute(db);
    return result.rows.map((row) => row.tableName).sort();
}

describe("migrations", () => {
    test("apply forward, rerun as a no-op, roll back fully, and reapply", async () => {
        await withDatabase(async (db) => {
            const applied = await migrateToLatest(db);
            expect(applied.map((entry) => entry.migrationName)).toEqual(EXPECTED_MIGRATIONS);

            // Reruns record no work, so deploy tooling can invoke the
            // migrator freely without racing applied history.
            expect(await migrateToLatest(db)).toHaveLength(0);

            const migrator = new Migrator({
                db,
                provider: new TsFileMigrationProvider(migrationsFolder),
            });
            const rolledBack = await migrator.migrateTo(NO_MIGRATIONS);
            expect(rolledBack.error).toBeUndefined();
            expect(await workflowTables(db)).toEqual([]);

            const reapplied = await migrateToLatest(db);
            expect(reapplied.map((entry) => entry.migrationName)).toEqual(EXPECTED_MIGRATIONS);
            expect(await workflowTables(db)).toEqual(["publications", "revisions", "workflows"]);
        });
    });
});
