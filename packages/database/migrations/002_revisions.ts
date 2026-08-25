import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "../src/schema/database";

/**
 * Creates `revisions`, the draft's immutable checkpoints. Also adds the
 * deferred `workflows.current_revision` foreign key: deferral lets a
 * transaction insert the revision and flip the pointer in one step.
 */
export async function up(db: Kysely<Database>): Promise<void> {
    await db.schema
        .createTable("revisions")
        .addColumn("id", "uuid", (col) => col.primaryKey())
        .addColumn("workflow_id", "uuid", (col) => col.notNull())
        // The exact submitted bytes; retrieval returns them unchanged and
        // findings' line and column stay anchored to this text (E1-S3).
        .addColumn("content", "text", (col) => col.notNull())
        // The validation findings snapshot, serialized JSON.
        .addColumn("findings", "text", (col) => col.notNull())
        // Optional caller-facing label for the revision; display data with
        // no lifecycle meaning.
        .addColumn("name", "text")
        .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
        .addForeignKeyConstraint("revisions_workflow_fk", ["workflow_id"], "workflows", ["id"])
        .execute();

    // Per-draft revision identity from E1-S3's save contract: a revision
    // belongs to exactly one draft, and every workflow-scoped read (the
    // current pointer, rewind candidates, publish lookups) filters by
    // workflow_id first. The primary key alone enforces uniqueness across
    // all drafts, so this index carries the scoping and the lookup path.
    await db.schema
        .createIndex("revisions_workflow_id_idx")
        .on("revisions")
        .columns(["workflow_id", "id"])
        .unique()
        .execute();

    // Raw DDL: workflows.current_revision and revisions.workflow_id form a
    // circular foreign-key pair, and the schema builder cannot express
    // DEFERRABLE INITIALLY DEFERRED, the marker that lets one transaction
    // insert the revision and flip the pointer before the pair validates.
    await sql`
        alter table workflows
            add constraint workflows_current_revision_fk
            foreign key (current_revision) references revisions (id)
            deferrable initially deferred
    `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
    // Remove the cross-table foreign key before dropping the table it points at.
    await sql`alter table workflows drop constraint workflows_current_revision_fk`.execute(db);
    await db.schema.dropIndex("revisions_workflow_id_idx").execute();
    await db.schema.dropTable("revisions").execute();
}
