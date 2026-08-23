/**
 * Entry point of the shared storage package.
 *
 * The package implements workflow persistence for every consumer —
 * Control API, daemon — on Postgres with Kysely (E1-S0) under the
 * lifecycle rules of E1-S3:
 *
 * - `createStorage` opens the typed connection; `migrateToLatest` applies
 *   the SQL-file migrations and is safe to rerun;
 * - `WorkflowStorage` saves revisions behind the optimistic `baseRevision`
 *   check, publishes immutable versions under per-workflow integer numbers,
 *   rewinds within the published-source boundary, and verifies stored
 *   digests at retrieval;
 * - `mintUuidV7` is the server's identity minter for workflow and revision
 *   ids (E1-S3 identity rule).
 */

export type {
    PublishedVersionRow,
    RevisionRow,
    WorkflowDatabase,
    WorkflowRow,
} from "./database";
export { createDatabase } from "./database";
export { DigestVerificationError, StorageError } from "./errors";
export { migrateToLatest, SqlFileMigrationProvider } from "./migrator";
export { createStorage, type RostrumStorage } from "./storage";
export { isUuidV7, mintUuidV7 } from "./uuid-v7";
export type {
    CreateDraftInput,
    CreatedDraft,
    PublishedVersion,
    PublishInput,
    PublishResult,
    RewindResult,
    SaveRevisionInput,
    SaveRevisionResult,
    StoredRevision,
} from "./workflow-storage";
export { WorkflowStorage } from "./workflow-storage";
