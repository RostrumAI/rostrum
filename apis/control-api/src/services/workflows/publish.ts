/** @fileoverview Workflow publication service. */

import { type Static, Type } from "typebox";
import { defineControlService } from "../../define";
import { ErrorResponseSchema } from "../../schemas";
import { CONTROL_API_TAG } from "../../tags";
import {
    WorkflowApiError,
    workflowNotFound,
    workflowNotValid,
    workflowRevisionNotFound,
} from "../../workflows/errors";
import { PublishResponseSchema, WorkflowIdSchema } from "../../workflows/schemas";

/**
 * Serves POST /api/workflows/:workflowId/publish. Re-runs validation on the
 * stored content — the same findings and ordering a save returned — then
 * stores the canonical text with its digest under the next publication number.
 */
export const publishWorkflow = defineControlService({
    method: "POST",
    path: "/api/workflows/:workflowId/publish",
    request: {
        params: Type.Object({ workflowId: WorkflowIdSchema }),
        paramsDescriptions: { workflowId: "The draft's workflow id." },
    },
    openapi: {
        operationId: "publishWorkflow",
        summary: "Publish a workflow draft",
        tags: [CONTROL_API_TAG.WORKFLOWS],
    },
    responses: {
        201: {
            description:
                "The current revision was published and stored as an immutable publication",
            body: PublishResponseSchema,
        },
        200: {
            description:
                "The current revision was already published: the response is identical and idempotent",
            body: PublishResponseSchema,
        },
        404: {
            description:
                "The workflow does not exist (code not_found), or its current revision does not (code revision_not_found)",
            body: ErrorResponseSchema,
        },
        422: {
            description:
                "The current revision has blocking validation findings; nothing is created and the body carries the findings",
            body: ErrorResponseSchema,
        },
    },
    schemas: {
        PublishResponse: PublishResponseSchema,
        ErrorResponse: ErrorResponseSchema,
    },
    handler: async (request, response, context) => {
        const { workflowId } = request.params;
        const result = await context.workflows.publish(workflowId);

        // A first publication answers 201 and a replay of the same revision
        // 200, so a caller can tell the two outcomes apart.
        switch (result.outcome) {
            case "published":
            case "already-published": {
                const published: Static<typeof PublishResponseSchema> = {
                    workflowId,
                    publicationNumber: result.publicationNumber,
                    workflowFormatVersion: result.workflowFormatVersion,
                    digest: result.digest,
                };
                return response.json(published, result.outcome === "published" ? 201 : 200);
            }
            case "blocking-findings":
                throw new WorkflowApiError(workflowNotValid(result.findings));
            case "workflow-not-found":
                throw new WorkflowApiError(
                    workflowNotFound(`Workflow ${workflowId} does not exist`),
                );
            case "revision-not-found":
                throw new WorkflowApiError(
                    workflowRevisionNotFound(
                        `The current revision of workflow ${workflowId} does not exist`,
                    ),
                );
        }
    },
});
