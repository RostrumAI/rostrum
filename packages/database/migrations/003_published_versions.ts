import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "../src/schema/database";

/**
 * Creates `published_versions`: immutable published releases with
 * per-workflow monotonic integer version numbers (E1-S3). A revision
 * publishes at most once; the unique `(workflow_id, revision_id)` index
 * decides the concurrent-publish race.
 */
export async function up(db: Kysely<Database>): Promise<void> {
    await db.schema
        .createTable("published_versions")
        .addColumn("workflow_id", "uuid", (col) => col.notNull())
        .addColumn("version_number", "integer", (col) => col.notNull())
        .addColumn("revision_id", "uuid", (col) => col.notNull())
        .addColumn("interface_version", "text", (col) => col.notNull())
        .addColumn("canonical_text", "text", (col) => col.notNull())
        .addColumn("digest", "text", (col) => col.notNull())
        .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
        .addForeignKeyConstraint("published_versions_workflow_fk", ["workflow_id"], "workflows", [
            "id",
        ])
        .addForeignKeyConstraint("published_versions_revision_fk", ["revision_id"], "revisions", [
            "id",
        ])
        .addPrimaryKeyConstraint("published_versions_pk", ["workflow_id", "version_number"])
        .addUniqueConstraint("published_versions_revision_unique", ["workflow_id", "revision_id"])
        .execute();

    // Raw DDL: check expressions are not expressible in the schema builder.
    await sql`alter table published_versions
        add constraint published_versions_version_number_check check (version_number >= 1)`.execute(
        db,
    );
    await sql`alter table published_versions
        add constraint published_versions_digest_check check (digest ~ '^[0-9a-f]{64}$')`.execute(
        db,
    );
}

export async function down(db: Kysely<Database>): Promise<void> {
    // The check constraints belong to this table and go with it.
    await db.schema.dropTable("published_versions").execute();
}
