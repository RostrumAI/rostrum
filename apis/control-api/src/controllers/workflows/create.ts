/** @fileoverview Workflow draft-creation controller. */

import { defineControlController } from "../../http/define";
import { CONTROL_API_TAG } from "../../http/tags";
import { ErrorResponse } from "../../schemas";
import { CreateDraftRequest } from "./create.schema";
import { extractDocumentText } from "./request-body";
import { revisionResponse, WorkflowRevision } from "./schemas";

/**
 * Serves POST /api/workflows: the collection route of the workflow area.
 * Creation is the first save, so the response is the draft's first revision,
 * carrying the workflow id the server assigned and injected into the stored
 * document.
 */
export const createWorkflowDraft = defineControlController({
    method: "POST",
    path: "/api/workflows",
    request: {
        body: CreateDraftRequest,
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
            body: WorkflowRevision,
        },
        400: {
            description:
                "The body is not a valid creation request, or the document is not syntactically valid workflow JSON",
            body: ErrorResponse,
        },
    },
    handler: async (request, response, context) => {
        const created = await context.services.workflows.createDraft(
            extractDocumentText(request.bodyText),
            request.body.name ?? null,
        );
        return response.json(revisionResponse(created.revision), 201);
    },
});
