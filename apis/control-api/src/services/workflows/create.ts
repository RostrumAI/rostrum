/** @fileoverview Workflow draft-creation service. */

import { defineControlService } from "../../define";
import { ErrorResponse } from "../../schemas";
import { CONTROL_API_TAG } from "../../tags";
import { extractDocumentText } from "../../workflows/request-body";
import { revisionResponse, WorkflowRevision } from "../../workflows/schemas";
import { CreateDraftRequest } from "./create.schema";

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
        const created = await context.database.workflows.createDraft(
            extractDocumentText(request.bodyText),
            request.body.name ?? null,
        );
        return response.json(revisionResponse(created.revision), 201);
    },
});
