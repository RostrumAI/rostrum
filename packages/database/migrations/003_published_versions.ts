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
        // The publishing draft.
        .addColumn("workflow_id", "uuid", (col) => col.notNull())
        // Gapless per-draft sequence starting at 1; WorkflowRepository.publish
        // allocates it behind the workflow row lock.
        .addColumn("version_number", "integer", (col) => col.notNull())
        // The source revision of the published bytes; the unique constraint
        // below makes a revision publish at most once.
        .addColumn("revision_id", "uuid", (col) => col.notNull())
        // The interface contract the published text satisfies (v1 today).
        .addColumn("interface_version", "text", (col) => col.notNull())
        // RFC 8785 canonical form stored verbatim; retrieval re-verifies it.
        .addColumn("canonical_text", "text", (col) => col.notNull())
        // SHA-256 of the definitional members only, display metadata excluded,
        // as lowercase hex.
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

    // Raw DDL for the two checks the schema builder cannot express: version
    // numbers start at 1, and a digest is exactly 64 lowercase hex chars.
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
