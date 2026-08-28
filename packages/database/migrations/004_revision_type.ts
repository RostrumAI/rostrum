import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "../src/schema/database";

/**
 * Adds `revisions.type`: how each revision came to exist — an author save
 * (`save`) or a rewind-appended copy (`rewind`). Existing rows are all
 * author saves, so the default backfills them; the check constraint keeps
 * future values inside the two-type vocabulary.
 */
export async function up(db: Kysely<Database>): Promise<void> {
    await db.schema
        .alterTable("revisions")
        .addColumn("type", "text", (col) => col.notNull().defaultTo("save"))
        .execute();

    // Raw DDL: the schema builder cannot express a check constraint over
    // the revision-type vocabulary.
    await sql`alter table revisions
        add constraint revisions_type_check check (type in ('save', 'rewind'))`.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
    // The check constraint belongs to the column and goes with it.
    await sql`alter table revisions drop constraint revisions_type_check`.execute(db);
    await db.schema.alterTable("revisions").dropColumn("type").execute();
}
