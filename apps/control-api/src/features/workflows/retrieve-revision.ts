import type { Context } from "hono";
import type { FeatureHandler, FeatureRoute, FeatureSchemas } from "../../loader";
import { ErrorResponseSchema } from "../../schemas";
import { notFound, WorkflowApiError, workflowErrorResponse } from "../../workflows/errors";
import { WorkflowRevisionSchema } from "../../workflows/schemas";
import { revisionResponse, workflowService } from "../../workflows/service";

/** Route binding for retrieving one stored revision. */
export const route: FeatureRoute = {
    method: "GET",
    path: "/:workflowId/revisions/:revisionId",
    parameters: [
        {
            name: "workflowId",
            in: "path",
            description: "The draft's workflow id (UUID v7).",
            schema: WorkflowRevisionSchema.properties.revisionId,
        },
        {
            name: "revisionId",
            in: "path",
            description: "The revision id (UUID v7) to retrieve.",
            schema: WorkflowRevisionSchema.properties.revisionId,
        },
    ],
    responses: {
        "200": {
            description: "The stored revision: exact bytes plus findings snapshot",
            schemaName: "WorkflowRevision",
        },
        "404": {
            description: "The workflow or revision does not exist",
            schemaName: "ErrorResponse",
        },
    },
};

/** OpenAPI components contributed by this slice. */
export const schema: FeatureSchemas = {
    WorkflowRevision: WorkflowRevisionSchema,
    ErrorResponse: ErrorResponseSchema,
};

/**
 * Serves GET /workflows/:workflowId/revisions/:revisionId. Returns the
 * stored revision unchanged, byte-exact, including rewind-appended copies.
 */
export const handler: FeatureHandler = async (c: Context) => {
    try {
        const workflowId = c.req.param("workflowId") ?? "";
        const revisionId = c.req.param("revisionId") ?? "";
        const revision = await workflowService().revision(workflowId, revisionId);
        if (!revision) {
            throw new WorkflowApiError(
                notFound(`Revision ${revisionId} of workflow ${workflowId} does not exist`),
            );
        }
        return c.json(revisionResponse(revision));
    } catch (error) {
        return workflowErrorResponse(c, error);
    }
};
