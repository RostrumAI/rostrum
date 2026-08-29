import type { Context } from "hono";
import type { FeatureHandler, FeatureRoute, FeatureSchemas } from "../../loader";
import { ErrorResponseSchema } from "../../schemas";
import type { Services } from "../../services";
import { WorkflowApiError, workflowErrorResponse, workflowNotFound } from "../../workflows/errors";
import {
    RevisionIdSchema,
    revisionResponse,
    WorkflowIdSchema,
    WorkflowRevisionSchema,
} from "../../workflows/schemas";

/** Route binding for retrieving one stored revision. */
export const route: FeatureRoute = {
    method: "GET",
    path: "/:workflowId/revisions/:revisionId",
    parameters: [
        {
            name: "workflowId",
            in: "path",
            description: "The draft's workflow id.",
            schema: WorkflowIdSchema,
        },
        {
            name: "revisionId",
            in: "path",
            description: "The revision id to retrieve.",
            schema: RevisionIdSchema,
        },
    ],
    responses: {
        "200": {
            description: "The stored revision: exact text plus findings snapshot",
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
export const createHandler =
    (services: Services): FeatureHandler =>
    async (c: Context) => {
        try {
            const workflowId = c.req.param("workflowId") ?? "";
            const revisionId = c.req.param("revisionId") ?? "";
            const revision = await services.workflows.getRevision(workflowId, revisionId);
            if (!revision) {
                throw new WorkflowApiError(
                    workflowNotFound(
                        `Revision ${revisionId} of workflow ${workflowId} does not exist`,
                    ),
                );
            }
            return c.json(revisionResponse(revision));
        } catch (error) {
            return workflowErrorResponse(c, error);
        }
    };
