/**
 * Storage-layer failures raised by @rostrum/storage.
 *
 * Query errors surface as Kysely/driver errors and are wrapped here only
 * when a driver code carries domain meaning (for example, the Postgres
 * unique-violation code behind {@link DuplicateWorkflowIdError}). The
 * subclasses split contract violations by the status class their consumer
 * maps them to: client input, identity conflicts, and server-side
 * invariant violations. Expected state rejections (stale `baseRevision`,
 * unknown workflows, missing revisions) return typed outcomes instead and
 * never throw.
 */

/** Base class for storage failures that are not driver query errors. */
export class StorageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StorageError";
    }
}

/**
 * Input rejected by a storage entry point (400-class): malformed ids,
 * empty content, or findings that are not an array. Entry points throw it
 * instead of returning an outcome because such input is a caller bug, not
 * a stale view of the database.
 */
export class InvalidWorkflowInputError extends StorageError {
    constructor(message: string) {
        super(message);
        this.name = "InvalidWorkflowInputError";
    }
}

/**
 * Stored state that violates a storage invariant (500-class): a workflow
 * row with a null current revision while saves are accepted, a revision
 * row missing mid-transaction, or an unparseable findings snapshot. The
 * failure is not retryable by the client.
 */
export class CorruptWorkflowStateError extends StorageError {
    constructor(message: string) {
        super(message);
        this.name = "CorruptWorkflowStateError";
    }
}

/**
 * A workflow `id` already exists (409-class). Wraps the Postgres
 * unique-violation raised by a duplicate {@link WorkflowStorage.createDraft}
 * so consumers never see a raw driver error; E1-06 maps it to an identity
 * conflict.
 */
export class DuplicateWorkflowIdError extends StorageError {
    constructor(workflowId: string) {
        super(`Workflow ${workflowId} already exists`);
        this.name = "DuplicateWorkflowIdError";
    }
}

/**
 * Raised when a stored published version fails verification at retrieval:
 * either the recomputed digest differs from the stored digest or the stored
 * text is not in canonical form (E1-07 digest verification).
 */
export class DigestVerificationError extends StorageError {
    constructor(workflowId: string, versionNumber: number, reason: string) {
        super(
            `Published version ${versionNumber} of workflow ${workflowId} failed verification: ${reason}`,
        );
        this.name = "DigestVerificationError";
    }
}
