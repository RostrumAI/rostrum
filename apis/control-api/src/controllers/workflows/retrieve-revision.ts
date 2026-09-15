/** @fileoverview Revision retrieval controller. */

import { Type } from "typebox";
import { defineControlController } from "../../http/define";
import { CONTROL_API_TAG } from "../../http/tags";
import { ErrorResponse } from "../../schemas";
import { WorkflowApiError, workflowNotFound } from "./errors";
import { RevisionIdSchema, revisionResponse, WorkflowIdSchema, WorkflowRevision } from "./schemas";

/**
 * Serves GET /api/workflows/:workflowId/revisions/:revisionId. Returns the
 * stored revision unchanged, byte-exact, including rewind-appended copies.
 */
export const retrieveWorkflowRevision = defineControlController({
    method: "GET",
    path: "/api/workflows/:workflowId/revisions/:revisionId",
    request: {
        params: Type.Object({
            workflowId: WorkflowIdSchema,
            revisionId: RevisionIdSchema,
        }),
        paramsDescriptions: {
            workflowId: "The draft's workflow id.",
            revisionId: "The revision id to retrieve.",
        },
    },
    openapi: {
        operationId: "retrieveWorkflowRevision",
        summary: "Retrieve a workflow revision",
        tags: [CONTROL_API_TAG.WORKFLOWS],
    },
    responses: {
        200: {
            description: "The stored revision: exact text plus findings snapshot",
            body: WorkflowRevision,
        },
        404: {
            description: "The workflow or revision does not exist",
            body: ErrorResponse,
        },
    },
    handler: async (request, response, context) => {
        const { workflowId, revisionId } = request.params;
        const revision = await context.services.workflows.getRevision(workflowId, revisionId);
        if (!revision) {
            throw new WorkflowApiError(
                workflowNotFound(`Revision ${revisionId} of workflow ${workflowId} does not exist`),
            );
        }
        return response.json(revisionResponse(revision));
    },
});
