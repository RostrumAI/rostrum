import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { WorkflowDatabase } from "../src/workflows/schema";

/**
 * Creates `workflows`: one row per draft, pointing at its current
 * revision. The current-revision foreign key arrives with 0002_revisions
 * because the revisions table does not exist yet (E1-S3 identity rule).
 */
export async function up(db: Kysely<WorkflowDatabase>): Promise<void> {
    await db.schema
        .createTable("workflows")
        .addColumn("id", "uuid", (col) => col.primaryKey())
        .addColumn("current_revision", "uuid")
        .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
        .execute();
}

export async function down(db: Kysely<WorkflowDatabase>): Promise<void> {
    await db.schema.dropTable("workflows").execute();
}
