/** @fileoverview The domain errors workflow authoring raises. */

import type { Finding } from "@rostrum/workflow";

/**
 * A submitted document that is not syntactically valid JSON: malformed text,
 * duplicate keys, `NaN`/`Infinity` literals, or invalid UTF-8. It carries the
 * parse findings that say where the text failed, because the document never
 * reached validation and no other stage can describe it.
 */
export class WorkflowDocumentParseError extends Error {
    /** The parse findings, anchored to the submitted text. */
    readonly findings: readonly Finding[];

    /** Creates the error from the findings that describe the parse failure. */
    constructor(findings: readonly Finding[]) {
        super("The workflow document could not be parsed");
        this.name = "WorkflowDocumentParseError";
        this.findings = findings;
    }
}

/**
 * A saved document whose embedded `id` names a different workflow than the
 * addressed one. The addressed workflow is authoritative, so the save is
 * refused instead of writing one workflow's content into another.
 */
export class WorkflowIdentityConflictError extends Error {
    /** Creates the error from the disagreement the caller must resolve. */
    constructor(message: string) {
        super(message);
        this.name = "WorkflowIdentityConflictError";
    }
}

/**
 * Input a storage entry point rejected as a caller bug: a malformed id, empty
 * content, or findings that are not an array. The service raises its own error
 * type so no storage-layer type crosses into the transport tier.
 */
export class WorkflowInputError extends Error {
    /** Creates the error from the storage layer's rejection message. */
    constructor(message: string) {
        super(message);
        this.name = "WorkflowInputError";
    }
}
