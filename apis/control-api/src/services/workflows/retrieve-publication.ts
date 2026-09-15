/** @fileoverview Publication retrieval service. */

import { type Static, Type } from "typebox";
import { defineControlService } from "../../define";
import { ErrorResponse } from "../../schemas";
import { CONTROL_API_TAG } from "../../tags";
import { WorkflowApiError, workflowNotFound } from "../../workflows/errors";
import {
    PublicationNumberSchema,
    PublicationResponse,
    type PublicationResponseSchema,
    WorkflowIdSchema,
} from "../../workflows/schemas";

/**
 * Serves GET /api/workflows/:workflowId/publications/:publicationNumber. The
 * content is the exact canonical text publication stored, so verification
 * stays client-reproducible from it. The publication number's shape is
 * enforced by the documented parameter schema, which answers 400 before the
 * handler.
 */
export const retrieveWorkflowPublication = defineControlService({
    method: "GET",
    path: "/api/workflows/:workflowId/publications/:publicationNumber",
    request: {
        params: Type.Object({
            workflowId: WorkflowIdSchema,
            publicationNumber: PublicationNumberSchema,
        }),
        paramsDescriptions: {
            workflowId: "The draft's workflow id.",
            publicationNumber: "The per-workflow publication number.",
        },
    },
    openapi: {
        operationId: "retrieveWorkflowPublication",
        summary: "Retrieve a workflow publication",
        tags: [CONTROL_API_TAG.WORKFLOWS],
    },
    responses: {
        200: {
            description:
                "The publication: canonical stored text, verified at retrieval by digest recomputation",
            body: PublicationResponse,
        },
        404: {
            description: "The workflow has no such publication",
            body: ErrorResponse,
        },
    },
    handler: async (request, response, context) => {
        const { workflowId, publicationNumber: requestedNumber } = request.params;
        const publicationNumber = Number.parseInt(requestedNumber, 10);
        const publication = await context.workflows.getPublication(workflowId, publicationNumber);
        if (!publication) {
            throw new WorkflowApiError(
                workflowNotFound(`Workflow ${workflowId} has no publication ${publicationNumber}`),
            );
        }

        // The published bytes are echoed with the digest they were verified
        // against, so a caller can reproduce the verification itself.
        const retrieved: Static<typeof PublicationResponseSchema> = {
            publicationNumber: publication.publicationNumber,
            revisionId: publication.revisionId,
            workflowFormatVersion: publication.workflowFormatVersion,
            digest: publication.digest,
            content: publication.canonicalText,
        };
        return response.json(retrieved);
    },
});
