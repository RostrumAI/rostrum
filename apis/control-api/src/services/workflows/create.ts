/** @fileoverview Workflow draft-creation service. */

import { defineControlService } from "../../define";
import { ErrorResponseSchema } from "../../schemas";
import { CONTROL_API_TAG } from "../../tags";
import { extractDocumentText } from "../../workflows/request-body";
import { revisionResponse, WorkflowRevisionSchema } from "../../workflows/schemas";
import { CreateDraftRequestSchema } from "./create.schema";

/**
 * Serves POST /api/workflows: the collection route of the workflow area.
 * Creation is the first save, so the response is the draft's first revision,
 * carrying the workflow id the server assigned and injected into the stored
 * document.
 */
export const createWorkflowDraft = defineControlService({
    method: "POST",
    path: "/api/workflows",
    request: {
        body: CreateDraftRequestSchema,
        bodyDescription:
            "The creation request body: the workflow document, with an optional revision name.",
    },
    openapi: {
        operationId: "createWorkflowDraft",
        summary: "Create a workflow draft",
        tags: [CONTROL_API_TAG.WORKFLOWS],
    },
    responses: {
        201: {
            description: "The draft was created and its first revision stored",
            body: WorkflowRevisionSchema,
        },
        400: {
            description:
                "The body is not a valid creation request, or the document is not syntactically valid workflow JSON",
            body: ErrorResponseSchema,
        },
    },
    schemas: {
        CreateDraftRequest: CreateDraftRequestSchema,
        WorkflowRevision: WorkflowRevisionSchema,
        ErrorResponse: ErrorResponseSchema,
    },
    handler: async (request, response, context) => {
        const created = await context.workflows.createDraft(
            extractDocumentText(request.bodyText),
            request.body.name ?? null,
        );
        return response.json(revisionResponse(created.revision), 201);
    },
});
