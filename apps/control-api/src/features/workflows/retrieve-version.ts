import type { Context } from "hono";
import type { FeatureHandler, FeatureRoute, FeatureSchemas } from "../../loader";
import { ErrorResponseSchema } from "../../schemas";
import {
    invalidWorkflowInput,
    notFound,
    WorkflowApiError,
    workflowErrorResponse,
} from "../../workflows/errors";
import { PublishedVersionResponseSchema, WorkflowRevisionSchema } from "../../workflows/schemas";
import { workflowService } from "../../workflows/service";

/** Route binding for retrieving one immutable published version. */
export const route: FeatureRoute = {
    method: "GET",
    path: "/:workflowId/versions/:versionNumber",
    parameters: [
        {
            name: "workflowId",
            in: "path",
            description: "The draft's workflow id (UUID v7).",
            schema: WorkflowRevisionSchema.properties.revisionId,
        },
        {
            name: "versionNumber",
            in: "path",
            description: "The per-workflow published version number.",
            schema: PublishedVersionResponseSchema.properties.versionNumber,
        },
    ],
    responses: {
        "200": {
            description:
                "The published version: canonical stored text, verified at retrieval by digest recomputation",
            schemaName: "PublishedVersionResponse",
        },
        "400": {
            description: "The version number is not a positive integer",
            schemaName: "ErrorResponse",
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
 * client-reproducible from it.
 */
export const handler: FeatureHandler = async (c: Context) => {
    try {
        const workflowId = c.req.param("workflowId") ?? "";
        const raw = c.req.param("versionNumber") ?? "";
        if (!/^\d+$/.test(raw)) {
            throw new WorkflowApiError(
                invalidWorkflowInput(`'${raw}' is not a published version number`),
            );
        }
        const versionNumber = Number(raw);
        if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) {
            throw new WorkflowApiError(
                invalidWorkflowInput(`'${raw}' is not a published version number`),
            );
        }
        const version = await workflowService().publishedVersion(workflowId, versionNumber);
        if (!version) {
            throw new WorkflowApiError(
                notFound(`Workflow ${workflowId} has no published version ${versionNumber}`),
            );
        }
        return c.json({
            versionNumber: version.versionNumber,
            revisionId: version.revisionId,
            interfaceVersion: version.interfaceVersion,
            digest: version.digest,
            content: version.canonicalText,
        });
    } catch (error) {
        return workflowErrorResponse(c, error);
    }
};
