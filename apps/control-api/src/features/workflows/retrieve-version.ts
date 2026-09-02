import type { Context } from "hono";
import type { Static } from "typebox";
import type { FeatureHandler, FeatureRoute, FeatureSchemas } from "../../loader";
import { ErrorResponseSchema } from "../../schemas";
import type { Services } from "../../services";
import { WorkflowApiError, workflowErrorResponse, workflowNotFound } from "../../workflows/errors";
import {
    PublishedVersionResponseSchema,
    VersionNumberSchema,
    WorkflowIdSchema,
} from "../../workflows/schemas";

/** Route binding for retrieving one immutable published version. */
export const route: FeatureRoute = {
    method: "GET",
    path: "/:workflowId/versions/:versionNumber",
    parameters: [
        {
            name: "workflowId",
            in: "path",
            description: "The draft's workflow id.",
            schema: WorkflowIdSchema,
        },
        {
            name: "versionNumber",
            in: "path",
            description: "The per-workflow published version number.",
            schema: VersionNumberSchema,
        },
    ],
    responses: {
        "200": {
            description:
                "The published version: canonical stored text, verified at retrieval by digest recomputation",
            schemaName: "PublishedVersionResponse",
        },
        "404": {
            description: "The workflow has no such published version",
            schemaName: "ErrorResponse",
        },
    },
};

/** OpenAPI components contributed by this slice. */
export const schema: FeatureSchemas = {
    PublishedVersionResponse: PublishedVersionResponseSchema,
    ErrorResponse: ErrorResponseSchema,
};

/**
 * Serves GET /workflows/:workflowId/versions/:versionNumber. The content
 * is the exact canonical text publication stored; verification stays
 * client-reproducible from it. The version number's shape is enforced by
 * the documented parameter schema, which answers 400 before the handler.
 */
export const createHandler =
    (services: Services): FeatureHandler =>
    async (c: Context) => {
        try {
            const workflowId = c.req.param("workflowId") ?? "";
            const raw = c.req.param("versionNumber") ?? "";
            const versionNumber = Number.parseInt(raw, 10);
            const version = await services.workflows.getPublishedVersion(workflowId, versionNumber);
            if (!version) {
                throw new WorkflowApiError(
                    workflowNotFound(
                        `Workflow ${workflowId} has no published version ${versionNumber}`,
                    ),
                );
            }
            const body: Static<typeof PublishedVersionResponseSchema> = {
                versionNumber: version.versionNumber,
                revisionId: version.revisionId,
                interfaceVersion: version.interfaceVersion,
                digest: version.digest,
                content: version.canonicalText,
            };
            return c.json(body);
        } catch (error) {
            return workflowErrorResponse(c, error);
        }
    };
