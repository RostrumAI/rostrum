import { CamelCasePlugin, Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";

/** One row of `workflows`: the draft and its current-revision pointer. */
export interface WorkflowRow {
    /** Server-minted workflow `id` (UUID v7); the draft shares it (E1-S3). */
    id: string;
    /** The draft's current revision, or null only before the first save lands. */
    currentRevision: string | null;
    createdAt: Date;
    updatedAt: Date;
}

/** One row of `revisions`: an immutable checkpoint of the draft. */
export interface RevisionRow {
    /** Server-minted revision `id` (UUID v7). */
    id: string;
    workflowId: string;
    /** The exact submitted bytes; retrieval returns them unchanged (E1-S3). */
    content: string;
    /** The validation findings snapshot, serialized as JSON. */
    findings: string;
    /** Optional author-supplied checkpoint label. */
    name: string | null;
    createdAt: Date;
}

/** One row of `published_versions`: an immutable published release. */
export interface PublishedVersionRow {
    workflowId: string;
    /** Per-workflow monotonic integer starting at 1 (E1-S3). */
    versionNumber: number;
    /** The source revision; rewind never deletes below it (E1-S3). */
    revisionId: string;
    /** The declared `interfaceVersion` of the published document. */
    interfaceVersion: string;
    /** The full RFC 8785 canonical document, metadata members included. */
    canonicalText: string;
    /** SHA-256 lowercase hex over the canonical form minus metadata members. */
    digest: string;
    createdAt: Date;
}

/** The Kysely database schema for workflow storage. */
export interface WorkflowDatabase {
    workflows: WorkflowRow;
    revisions: RevisionRow;
    publishedVersions: PublishedVersionRow;
}

/**
 * Creates the typed Kysely instance over postgres.js. The CamelCase plugin
 * maps TypeScript identifiers to the snake_case columns the migrations
 * define, so queries stay idiomatic without duplicating column names.
 */
export function createDatabase(databaseUrl: string): Kysely<WorkflowDatabase> {
    return new Kysely<WorkflowDatabase>({
        dialect: new PostgresJSDialect({ postgres: postgres(databaseUrl) }),
        plugins: [new CamelCasePlugin()],
    });
}
