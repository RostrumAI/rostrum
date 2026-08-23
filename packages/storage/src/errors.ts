/**
 * Storage-layer failures raised by @rostrum/storage.
 *
 * Query errors surface as Kysely/driver errors; these classes cover
 * contract violations this package detects itself.
 */

/** Base class for storage failures that are not driver query errors. */
export class StorageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StorageError";
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
