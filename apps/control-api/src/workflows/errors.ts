import { InvalidWorkflowInputError, type StoredRevision } from "@rostrum/database";
import type { Finding } from "@rostrum/workflow";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * The workflow operations' one mapping module: every storage outcome and
 * typed error converts to an HTTP status here, in the single error shape
 * every Control API response shares. Handlers build responses from these
 * payloads and rethrow everything the module does not map, which routes
 * storage-invariant failures (`CorruptWorkflowStateError`,
 * `DigestVerificationError`, and a duplicate id on the unreachable mint
 * collision) through the app's `onError` path as 500 `internal_error`
 * with logging.
 */

/** Statuses the workflow operations return for mapped failures. */
type MappedStatus = 400 | 404 | 409 | 422;

/** One mapped error response payload, in the single error shape. */
export interface ErrorPayload {
    readonly status: MappedStatus;
    readonly code: string;
    readonly message: string;
    readonly findings: readonly Finding[];
    readonly currentRevision?: string;
}

/**
 * An input-level workflow failure raised on the path between the HTTP
 * request and storage: parse failures, identity conflicts, malformed
 * bodies. Carries its mapped payload so handlers answer without a second
 * mapping step.
 */
export class WorkflowApiError extends Error {
    readonly payload: ErrorPayload;

    /** Creates the error from the payload the handler will respond with. */
    constructor(payload: ErrorPayload) {
        super(payload.message);
        this.name = "WorkflowApiError";
        this.payload = payload;
    }
}

/** Maps a parse failure (invalid JSON, duplicate keys, non-UTF-8) to 400. */
export function workflowParseFailure(findings: readonly Finding[]): ErrorPayload {
    return {
        status: 400,
        code: "invalid_workflow_input",
        message: "The workflow document could not be parsed",
        findings,
    };
}

/** Maps malformed request input that is not a document to 400. */
export function invalidWorkflowInput(message: string): ErrorPayload {
    return { status: 400, code: "invalid_workflow_input", message, findings: [] };
}

/** Maps an unknown workflow or published version to 404. */
export function workflowNotFound(message: string): ErrorPayload {
    return { status: 404, code: "not_found", message, findings: [] };
}

/** Maps an unknown rewind target or publish source revision to 404. */
export function workflowRevisionNotFound(message: string): ErrorPayload {
    return { status: 404, code: "revision_not_found", message, findings: [] };
}

/** Maps a saved document whose embedded `id` disagrees with the address to 409. */
export function workflowIdentityConflict(message: string): ErrorPayload {
    return { status: 409, code: "identity_conflict", message, findings: [] };
}

/** Maps a stale base revision to 409, carrying the current revision and its findings. */
export function workflowRevisionConflict(currentRevision: StoredRevision): ErrorPayload {
    return {
        status: 409,
        code: "revision_conflict",
        message:
            "The draft has newer work: the saved revision is not the current one. Re-read the current revision, then retry.",
        findings: currentRevision.findings,
        currentRevision: currentRevision.revisionId,
    };
}

/** Maps a publish rejected for blocking findings to 422; nothing is created. */
export function workflowNotValid(findings: readonly Finding[]): ErrorPayload {
    return {
        status: 422,
        code: "workflow_not_valid",
        message: "The draft's current revision has blocking findings and cannot be published",
        findings,
    };
}

/**
 * Maps one thrown error to its response payload, or returns null when the
 * caller must rethrow: storage-invariant violations (`CorruptWorkflowStateError`,
 * `DigestVerificationError`, `DuplicateWorkflowIdError`) and unknown
 * errors surface as 500 `internal_error` through the app's `onError` path.
 */
export function errorPayloadFor(error: unknown): ErrorPayload | null {
    if (error instanceof WorkflowApiError) return error.payload;
    if (error instanceof InvalidWorkflowInputError) {
        return invalidWorkflowInput(error.message);
    }
    return null;
}

/** Builds the response body for one mapped payload, in the single error shape. */
export function errorBody(payload: ErrorPayload): Record<string, unknown> {
    return {
        code: payload.code,
        message: payload.message,
        findings: [...payload.findings],
        ...(payload.currentRevision === undefined
            ? {}
            : { currentRevision: payload.currentRevision }),
    };
}

/**
 * Answers a handler failure from the mapping table, or rethrows when the
 * error maps to nothing: the rethrow reaches the app's `onError` path,
 * which logs and answers 500 `internal_error`.
 */
export function workflowErrorResponse(c: Context, error: unknown): Response {
    const payload = errorPayloadFor(error);
    if (payload === null) throw error;
    return c.json(errorBody(payload), payload.status as ContentfulStatusCode);
}
