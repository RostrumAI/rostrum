import type { Revision } from "@rostrum/database";
import type { Finding } from "@rostrum/workflow";
import {
    WorkflowDocumentParseError,
    WorkflowIdentityConflictError,
    WorkflowInputError,
} from "../../services/workflows/workflow-errors";

/**
 * The workflow area's one error mapping: the errors the workflow service raises
 * and the ones a controller raises convert to an HTTP status here, in the single
 * error shape every Control API response shares. Controllers build responses
 * from these payloads and rethrow everything the module does not map, which
 * routes storage-invariant failures (`CorruptWorkflowStateError`,
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
 * A workflow failure a controller raises for an outcome it must answer itself,
 * such as a missing draft or a publish the stored findings block. Carries its
 * mapped payload so the controller answers without a second mapping step.
 */
export class WorkflowApiError extends Error {
    readonly payload: ErrorPayload;

    /** Creates the error from the payload the controller will respond with. */
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

/** Maps an unknown workflow or publication to 404. */
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
export function workflowRevisionConflict(currentRevision: Revision): ErrorPayload {
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
    if (error instanceof WorkflowApiError) {
        return error.payload;
    }
    if (error instanceof WorkflowDocumentParseError) {
        return workflowParseFailure(error.findings);
    }
    if (error instanceof WorkflowIdentityConflictError) {
        return workflowIdentityConflict(error.message);
    }
    if (error instanceof WorkflowInputError) {
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
