import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { WorkflowDatabase } from "../src/workflows/schema";

/**
 * Creates `revisions`: the draft's immutable checkpoints. Also adds the
 * deferred `workflows.current_revision` foreign key — deferral lets a
 * transaction insert the revision and flip the pointer in one step.
 */
export async function up(db: Kysely<WorkflowDatabase>): Promise<void> {
    await db.schema
        .createTable("revisions")
        .addColumn("id", "uuid", (col) => col.primaryKey())
        .addColumn("workflow_id", "uuid", (col) => col.notNull())
        // The exact submitted bytes; retrieval returns them unchanged and
        // findings' line and column stay anchored to this text (E1-S3).
        .addColumn("content", "text", (col) => col.notNull())
        // The validation findings snapshot, serialized JSON.
        .addColumn("findings", "text", (col) => col.notNull())
        .addColumn("name", "text")
        .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
        .addForeignKeyConstraint("revisions_workflow_fk", ["workflow_id"], "workflows", ["id"])
        .execute();

    // Backstop unique index named by E1-S3's save contract; the primary key
    // already enforces global uniqueness.
    await db.schema
        .createIndex("revisions_workflow_backstop_idx")
        .on("revisions")
        .columns(["workflow_id", "id"])
        .unique()
        .execute();

    // Raw DDL: the constraint must be DEFERRABLE INITIALLY DEFERRED, which
    // the schema builder does not express.
    await sql`
        alter table workflows
            add constraint workflows_current_revision_fk
            foreign key (current_revision) references revisions (id)
            deferrable initially deferred
    `.execute(db);
}

export async function down(db: Kysely<WorkflowDatabase>): Promise<void> {
    await sql`alter table workflows drop constraint workflows_current_revision_fk`.execute(db);
    await db.schema.dropIndex("revisions_workflow_backstop_idx").execute();
    await db.schema.dropTable("revisions").execute();
}
