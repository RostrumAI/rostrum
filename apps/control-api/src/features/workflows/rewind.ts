import type { Context } from "hono";
import type { FeatureHandler, FeatureRoute, FeatureSchemas } from "../../loader";
import { ErrorResponseSchema } from "../../schemas";
import type { Services } from "../../services";
import {
    WorkflowApiError,
    workflowErrorResponse,
    workflowNotFound,
    workflowRevisionNotFound,
} from "../../workflows/errors";
import { readValidatedBody } from "../../workflows/request-body";
import {
    RewindRequestSchema,
    revisionResponse,
    WorkflowIdSchema,
    WorkflowRevisionSchema,
} from "../../workflows/schemas";

/**
 * Route binding for rewinding the draft to an earlier revision. The
 * rewind appends a copy of the target as the newest revision and makes it
 * current; nothing is deleted, so every published version's source stays
 * retrievable.
 */
export const route: FeatureRoute = {
    method: "POST",
    path: "/:workflowId/rewind",
    requestBody: {
        description: "The rewind envelope naming the target revision.",
        required: true,
        schemaName: "RewindRequest",
    },
    parameters: [
        {
            name: "workflowId",
            in: "path",
            description: "The draft's workflow id.",
            schema: WorkflowIdSchema,
        },
    ],
    responses: {
        "200": {
            description:
                "The draft now shows the target revision (a rewind to the current revision is a no-op)",
            schemaName: "WorkflowRevision",
        },
        "400": {
            description: "The body is not a valid rewind envelope",
            schemaName: "ErrorResponse",
        },
        "404": {
            description:
                "The workflow does not exist (code not_found), or the target revision does not (code revision_not_found)",
            schemaName: "ErrorResponse",
        },
    },
};

/** OpenAPI components contributed by this slice. */
export const schema: FeatureSchemas = {
    RewindRequest: RewindRequestSchema,
    WorkflowRevision: WorkflowRevisionSchema,
    ErrorResponse: ErrorResponseSchema,
};

/**
 * Serves POST /workflows/:workflowId/rewind. Rewinding to the current
 * revision is a no-op that still answers with that revision.
 */
export const createHandler =
    (services: Services): FeatureHandler =>
    async (c: Context) => {
        try {
            const workflowId = c.req.param("workflowId") ?? "";
            const envelope = await readValidatedBody(c, RewindRequestSchema);
            const result = await services.workflows.rewind(workflowId, envelope.targetRevisionId);
            switch (result.outcome) {
                case "rewound":
                case "no-op":
                    return c.json(revisionResponse(result.revision));
                case "target-not-found":
                    throw new WorkflowApiError(
                        workflowRevisionNotFound(
                            `Revision ${envelope.targetRevisionId} of workflow ${workflowId} does not exist`,
                        ),
                    );
                case "not-found":
                    throw new WorkflowApiError(
                        workflowNotFound(`Workflow ${workflowId} does not exist`),
                    );
            }
        } catch (error) {
            return workflowErrorResponse(c, error);
        }
    };
