/** @fileoverview Revision retrieval service. */

import { Type } from "typebox";
import { defineControlService } from "../../define";
import { ErrorResponseSchema } from "../../schemas";
import { CONTROL_API_TAG } from "../../tags";
import { WorkflowApiError, workflowNotFound } from "../../workflows/errors";
import {
    RevisionIdSchema,
    revisionResponse,
    WorkflowIdSchema,
    WorkflowRevisionSchema,
} from "../../workflows/schemas";

/**
 * Serves GET /api/workflows/:workflowId/revisions/:revisionId. Returns the
 * stored revision unchanged, byte-exact, including rewind-appended copies.
 */
export const retrieveWorkflowRevision = defineControlService({
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
            body: WorkflowRevisionSchema,
        },
        404: {
            description: "The workflow or revision does not exist",
            body: ErrorResponseSchema,
        },
    },
    schemas: {
        WorkflowRevision: WorkflowRevisionSchema,
        ErrorResponse: ErrorResponseSchema,
    },
    handler: async (request, response, context) => {
        const { workflowId, revisionId } = request.params;
        const revision = await context.workflows.getRevision(workflowId, revisionId);
        if (!revision) {
            throw new WorkflowApiError(
                workflowNotFound(`Revision ${revisionId} of workflow ${workflowId} does not exist`),
            );
        }
        return response.json(revisionResponse(revision));
    },
});
