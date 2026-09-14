/**
 * @fileoverview Entry point of the database package.
 *
 * The package owns the Postgres schema end to end. `src/schema/` declares
 * what can physically exist in Postgres — the Kysely table map the
 * migration modules in `migrations/` implement at runtime — and the
 * repositories define how Rostrum reads and writes that data: transactions,
 * row locks, optimistic checks, immutability rules, and the mapping
 * between stored rows and application values. Validation and publication
 * preparation stay in @rostrum/workflow; applications depend on this
 * package one-way, and it depends on no application.
 */

export type { DatabaseCheck, DatabaseHandle, DatabaseOptions } from "./client";
export { createDatabase, validateDatabaseOptions } from "./client";
export { migrateToLatest, TsFileMigrationProvider } from "./migrator";
export { WorkflowRepository } from "./repositories/workflow-repository";
export {
    CorruptWorkflowStateError,
    DigestVerificationError,
    DuplicateWorkflowIdError,
    InvalidWorkflowInputError,
    StorageError,
} from "./repositories/workflow-repository.errors";
export type {
    CreateDraftInput,
    CreatedDraft,
    Publication,
    PublishInput,
    PublishResult,
    RewindResult,
    SaveRevisionInput,
    SaveRevisionResult,
    StoredRevision,
} from "./repositories/workflow-repository.types";
export type { Database } from "./schema/database";
export type { PublicationRow } from "./schema/publications";
export type { RevisionRow, RevisionType } from "./schema/revisions";
export type { WorkflowRow } from "./schema/workflows";
