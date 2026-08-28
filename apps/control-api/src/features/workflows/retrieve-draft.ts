import type { Context } from "hono";
import type { FeatureHandler, FeatureRoute, FeatureSchemas } from "../../loader";
import { ErrorResponseSchema } from "../../schemas";
import { notFound, WorkflowApiError, workflowErrorResponse } from "../../workflows/errors";
import { WorkflowRevisionSchema } from "../../workflows/schemas";
import { revisionResponse, workflowService } from "../../workflows/service";

/** Route binding for retrieving the draft's current revision. */
export const route: FeatureRoute = {
    method: "GET",
    path: "/:workflowId",
    parameters: [
        {
            name: "workflowId",
            in: "path",
            description: "The draft's workflow id (UUID v7).",
            schema: WorkflowRevisionSchema.properties.revisionId,
        },
    ],
    responses: {
        "200": {
            description: "The draft's current revision: stored bytes plus findings snapshot",
            schemaName: "WorkflowRevision",
        },
        "404": { description: "The workflow does not exist", schemaName: "ErrorResponse" },
    },
};

/** OpenAPI components contributed by this slice. */
export const schema: FeatureSchemas = {
    WorkflowRevision: WorkflowRevisionSchema,
    ErrorResponse: ErrorResponseSchema,
};

/**
 * Serves GET /workflows/:workflowId. Returns the current revision with
 * the exact stored bytes, so findings' line and column anchor to the text
 * a client reads.
 */
export const handler: FeatureHandler = async (c: Context) => {
    try {
        const workflowId = c.req.param("workflowId") ?? "";
        const revision = await workflowService().currentRevision(workflowId);
        if (!revision) {
            throw new WorkflowApiError(notFound(`Workflow ${workflowId} does not exist`));
        }
        return c.json(revisionResponse(revision));
    } catch (error) {
        return workflowErrorResponse(c, error);
    }
};
