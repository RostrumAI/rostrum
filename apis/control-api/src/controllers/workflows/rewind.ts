/** @fileoverview Workflow draft-rewind controller. */

import { Type } from "typebox";
import { defineControlController } from "../../http/define";
import { CONTROL_API_TAG } from "../../http/tags";
import { ErrorResponse } from "../../schemas";
import { WorkflowApiError, workflowNotFound, workflowRevisionNotFound } from "./errors";
import { RewindRequest, revisionResponse, WorkflowIdSchema, WorkflowRevision } from "./schemas";

/**
 * Serves POST /api/workflows/:workflowId/rewind. The rewind appends a copy of
 * the target as the newest revision and makes it current; nothing is deleted,
 * so every publication's source stays retrievable. Rewinding to the current
 * revision is a no-op that still answers with that revision.
 */
export const rewindWorkflow = defineControlController({
    method: "POST",
    path: "/api/workflows/:workflowId/rewind",
    request: {
        body: RewindRequest,
        params: Type.Object({ workflowId: WorkflowIdSchema }),
        paramsDescriptions: { workflowId: "The draft's workflow id." },
        bodyDescription: "The rewind request body, naming the target revision.",
    },
    openapi: {
        operationId: "rewindWorkflow",
        summary: "Rewind a workflow draft",
        tags: [CONTROL_API_TAG.WORKFLOWS],
    },
    responses: {
        200: {
            description:
                "The draft now shows the target revision (a rewind to the current revision is a no-op)",
            body: WorkflowRevision,
        },
        400: { description: "The body is not a valid rewind request", body: ErrorResponse },
        404: {
            description:
                "The workflow does not exist (code not_found), or the target revision does not (code revision_not_found)",
            body: ErrorResponse,
        },
    },
    handler: async (request, response, context) => {
        const { workflowId } = request.params;
        const { targetRevisionId } = request.body;
        const result = await context.services.workflows.rewind(workflowId, targetRevisionId);

        // Both successful outcomes answer with the revision the draft now
        // shows; the missing workflow and target are errors the app maps.
        switch (result.outcome) {
            case "rewound":
            case "no-op":
                return response.json(revisionResponse(result.revision));
            case "target-not-found":
                throw new WorkflowApiError(
                    workflowRevisionNotFound(
                        `Revision ${targetRevisionId} of workflow ${workflowId} does not exist`,
                    ),
                );
            case "workflow-not-found":
                throw new WorkflowApiError(
                    workflowNotFound(`Workflow ${workflowId} does not exist`),
                );
        }
    },
});
