/** @fileoverview Draft retrieval service. */

import { Type } from "typebox";
import { defineControlService } from "../../define";
import { ErrorResponseSchema } from "../../schemas";
import { CONTROL_API_TAG } from "../../tags";
import { WorkflowApiError, workflowNotFound } from "../../workflows/errors";
import {
    revisionResponse,
    WorkflowIdSchema,
    WorkflowRevisionSchema,
} from "../../workflows/schemas";

/**
 * Serves GET /api/workflows/:workflowId. Returns the current revision with the
 * exact stored text, so findings' line and column anchor to the text a client
 * reads.
 */
export const retrieveWorkflowDraft = defineControlService({
    method: "GET",
    path: "/api/workflows/:workflowId",
    request: {
        params: Type.Object({ workflowId: WorkflowIdSchema }),
        paramsDescriptions: { workflowId: "The draft's workflow id." },
    },
    openapi: {
        operationId: "retrieveWorkflowDraft",
        summary: "Retrieve a workflow draft",
        tags: [CONTROL_API_TAG.WORKFLOWS],
    },
    responses: {
        200: {
            description: "The draft's current revision: stored text plus findings snapshot",
            body: WorkflowRevisionSchema,
        },
        404: { description: "The workflow does not exist", body: ErrorResponseSchema },
    },
    schemas: {
        WorkflowRevision: WorkflowRevisionSchema,
        ErrorResponse: ErrorResponseSchema,
    },
    handler: async (request, response, context) => {
        const { workflowId } = request.params;
        const revision = await context.workflows.getCurrentRevision(workflowId);
        if (!revision) {
            throw new WorkflowApiError(workflowNotFound(`Workflow ${workflowId} does not exist`));
        }
        return response.json(revisionResponse(revision));
    },
});
