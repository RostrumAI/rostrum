import { describe, expect, test } from "bun:test";
import {
    CorruptWorkflowStateError,
    DigestVerificationError,
    DuplicateWorkflowIdError,
    InvalidWorkflowInputError,
} from "@rostrum/database";
import type { Finding } from "@rostrum/workflow";
import {
    duplicateWorkflowId,
    errorBody,
    errorPayloadFor,
    identityConflict,
    invalidWorkflowInput,
    notFound,
    parseFailure,
    revisionConflict,
    revisionNotFound,
    WorkflowApiError,
    workflowNotValid,
} from "./errors";

const FINDINGS: Finding[] = [
    {
        code: "workflow.shape.required-field",
        message: "steps is required",
        blocking: true,
        path: "",
    },
];

const CURRENT_REVISION = {
    revisionId: "0192b0a0-7e1d-7000-8000-0000000000cc",
    workflowId: "0192b0a0-7e1d-7000-8000-0000000000cd",
    name: null,
    content: `{"name":"x"}`,
    type: "save" as const,
    findings: FINDINGS,
    createdAt: new Date(0),
};

/** The full status/code mapping table, one assertion per documented trigger. */
describe("error payload mapping table", () => {
    test("parse failures map to 400 invalid_workflow_input carrying the parse findings", () => {
        const payload = parseFailure(FINDINGS);
        expect(payload.status).toBe(400);
        expect(payload.code).toBe("invalid_workflow_input");
        expect(payload.findings).toEqual(FINDINGS);
    });

    test("malformed request input maps to 400 invalid_workflow_input", () => {
        const payload = invalidWorkflowInput("The Base-Revision header is required");
        expect(payload.status).toBe(400);
        expect(payload.code).toBe("invalid_workflow_input");
        expect(payload.findings).toEqual([]);
    });

    test("unknown workflow or version maps to 404 not_found", () => {
        const payload = notFound("Workflow x does not exist");
        expect(payload.status).toBe(404);
        expect(payload.code).toBe("not_found");
    });

    test("missing rewind target or publish source maps to 404 revision_not_found", () => {
        const payload = revisionNotFound("no such revision");
        expect(payload.status).toBe(404);
        expect(payload.code).toBe("revision_not_found");
    });

    test("a disagreeing embedded id maps to 409 identity_conflict", () => {
        const payload = identityConflict("embedded id does not match");
        expect(payload.status).toBe(409);
        expect(payload.code).toBe("identity_conflict");
    });

    test("a stale base revision maps to 409 revision_conflict with the current revision", () => {
        const payload = revisionConflict(CURRENT_REVISION);
        expect(payload.status).toBe(409);
        expect(payload.code).toBe("revision_conflict");
        expect(payload.currentRevision).toBe(CURRENT_REVISION.revisionId);
        expect(payload.findings).toEqual(FINDINGS);
    });

    test("an id collision maps to 409 duplicate_workflow_id", () => {
        const error = new DuplicateWorkflowIdError("0192b0a0-7e1d-7000-8000-0000000000cd");
        const payload = duplicateWorkflowId(error);
        expect(payload.status).toBe(409);
        expect(payload.code).toBe("duplicate_workflow_id");
        expect(payload.message).toContain("already exists");
    });

    test("blocking findings on publish map to 422 workflow_not_valid", () => {
        const payload = workflowNotValid(FINDINGS);
        expect(payload.status).toBe(422);
        expect(payload.code).toBe("workflow_not_valid");
        expect(payload.findings).toEqual(FINDINGS);
    });
});

describe("errorPayloadFor", () => {
    test("maps a raised WorkflowApiError to its payload", () => {
        const error = new WorkflowApiError(notFound("nope"));
        expect(errorPayloadFor(error)).toEqual(notFound("nope"));
    });

    test("maps InvalidWorkflowInputError to 400", () => {
        const error = new InvalidWorkflowInputError("'x' is not a UUID v7 workflow id");
        const payload = errorPayloadFor(error);
        expect(payload?.status).toBe(400);
        expect(payload?.code).toBe("invalid_workflow_input");
        expect(payload?.message).toContain("not a UUID v7");
    });

    test("maps DuplicateWorkflowIdError to 409", () => {
        const error = new DuplicateWorkflowIdError("0192b0a0-7e1d-7000-8000-0000000000cd");
        const payload = errorPayloadFor(error);
        expect(payload?.status).toBe(409);
        expect(payload?.code).toBe("duplicate_workflow_id");
    });

    test("returns null for storage-invariant and digest-verification failures", () => {
        expect(errorPayloadFor(new CorruptWorkflowStateError("missing revision"))).toBeNull();
        expect(
            errorPayloadFor(
                new DigestVerificationError(
                    "0192b0a0-7e1d-7000-8000-0000000000cd",
                    1,
                    "digest mismatch",
                ),
            ),
        ).toBeNull();
    });

    test("returns null for unknown errors", () => {
        expect(errorPayloadFor(new Error("boom"))).toBeNull();
        expect(errorPayloadFor("not an error")).toBeNull();
    });
});

describe("errorBody", () => {
    test("carries the single error shape and omits an absent currentRevision", () => {
        const body = errorBody(notFound("nope"));
        expect(body).toEqual({ code: "not_found", message: "nope", findings: [] });
    });

    test("carries currentRevision on conflicts", () => {
        const body = errorBody(revisionConflict(CURRENT_REVISION));
        expect(body.currentRevision).toBe(CURRENT_REVISION.revisionId);
        expect(body.findings).toEqual(FINDINGS);
    });
});
