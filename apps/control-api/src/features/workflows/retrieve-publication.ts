import type { Context } from "hono";
import type { Static } from "typebox";
import type { FeatureHandler, FeatureRoute, FeatureSchemas } from "../../loader";
import { ErrorResponseSchema } from "../../schemas";
import type { Services } from "../../services";
import { WorkflowApiError, workflowErrorResponse, workflowNotFound } from "../../workflows/errors";
import {
    PublicationNumberSchema,
    PublicationResponseSchema,
    WorkflowIdSchema,
} from "../../workflows/schemas";

/** Route binding for retrieving one immutable publication. */
export const route: FeatureRoute = {
    method: "GET",
    path: "/:workflowId/publications/:publicationNumber",
    parameters: [
        {
            name: "workflowId",
            in: "path",
            description: "The draft's workflow id.",
            schema: WorkflowIdSchema,
        },
        {
            name: "publicationNumber",
            in: "path",
            description: "The per-workflow publication number.",
            schema: PublicationNumberSchema,
        },
    ],
    responses: {
        "200": {
            description:
                "The publication: canonical stored text, verified at retrieval by digest recomputation",
            schemaName: "PublicationResponse",
        },
        "404": {
            description: "The workflow has no such publication",
            schemaName: "ErrorResponse",
        },
    },
};

/** OpenAPI components contributed by this slice. */
export const schema: FeatureSchemas = {
    PublicationResponse: PublicationResponseSchema,
    ErrorResponse: ErrorResponseSchema,
};

/**
 * Serves GET /workflows/:workflowId/publications/:publicationNumber. The content
 * is the exact canonical text publication stored; verification stays
 * client-reproducible from it. The publication number's shape is enforced by
 * the documented parameter schema, which answers 400 before the handler.
 */
export const createHandler =
    (services: Services): FeatureHandler =>
    async (c: Context) => {
        try {
            const workflowId = c.req.param("workflowId") ?? "";
            const raw = c.req.param("publicationNumber") ?? "";
            const publicationNumber = Number.parseInt(raw, 10);
            const publication = await services.workflows.getPublication(
                workflowId,
                publicationNumber,
            );
            if (!publication) {
                throw new WorkflowApiError(
                    workflowNotFound(
                        `Workflow ${workflowId} has no publication ${publicationNumber}`,
                    ),
                );
            }
            const body: Static<typeof PublicationResponseSchema> = {
                publicationNumber: publication.publicationNumber,
                revisionId: publication.revisionId,
                workflowFormatVersion: publication.workflowFormatVersion,
                digest: publication.digest,
                content: publication.canonicalText,
            };
            return c.json(body);
        } catch (error) {
            return workflowErrorResponse(c, error);
        }
    };
