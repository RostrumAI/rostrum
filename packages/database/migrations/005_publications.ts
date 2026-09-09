import { type Kysely, sql } from "kysely";
import type { Database } from "../src/schema/database";

/**
 * Renames `published_versions` to `publications` with the new column names.
 *
 * Storage migration treatment for the PLAN_1 version-model simplification:
 * pre-release development databases carry no durable data, so this additive
 * migration renames the table and its version columns in place instead of
 * rewriting revision history. Saved revision text still contains the
 * workflow document's `workflowFormatVersion` member (renamed by the
 * workflow package); publication digests stay valid because the rename
 * preserves every stored row byte-for-byte except the column names.
 */
export async function up(db: Kysely<Database>): Promise<void> {
    await sql`alter table published_versions rename to publications`.execute(db);
    await sql`alter table publications rename column version_number to publication_number`.execute(
        db,
    );
    await sql`alter table publications rename column interface_version to workflow_format_version`.execute(
        db,
    );
    await sql`alter table publications rename constraint published_versions_pk to publications_pk`.execute(
        db,
    );
    await sql`alter table publications rename constraint published_versions_workflow_fk to publications_workflow_fk`.execute(
        db,
    );
    await sql`alter table publications rename constraint published_versions_revision_fk to publications_revision_fk`.execute(
        db,
    );
    await sql`alter table publications rename constraint published_versions_revision_unique to publications_revision_unique`.execute(
        db,
    );
    await sql`alter table publications rename constraint published_versions_version_number_check to publications_publication_number_check`.execute(
        db,
    );
    await sql`alter table publications rename constraint published_versions_digest_check to publications_digest_check`.execute(
        db,
    );
}

export async function down(db: Kysely<Database>): Promise<void> {
    await sql`alter table publications rename constraint publications_digest_check to published_versions_digest_check`.execute(
        db,
    );
    await sql`alter table publications rename constraint publications_publication_number_check to published_versions_version_number_check`.execute(
        db,
    );
    await sql`alter table publications rename constraint publications_revision_unique to published_versions_revision_unique`.execute(
        db,
    );
    await sql`alter table publications rename constraint publications_revision_fk to published_versions_revision_fk`.execute(
        db,
    );
    await sql`alter table publications rename constraint publications_workflow_fk to published_versions_workflow_fk`.execute(
        db,
    );
    await sql`alter table publications rename constraint publications_pk to published_versions_pk`.execute(
        db,
    );
    await sql`alter table publications rename column workflow_format_version to interface_version`.execute(
        db,
    );
    await sql`alter table publications rename column publication_number to version_number`.execute(
        db,
    );
    await sql`alter table publications rename to published_versions`.execute(db);
}
