import type { Context } from "hono";
import type { FeatureHandler, FeatureRoute, FeatureSchemas } from "../../loader";
import { ErrorResponseSchema } from "../../schemas";
import {
    invalidWorkflowInput,
    notFound,
    revisionNotFound,
    WorkflowApiError,
    workflowErrorResponse,
} from "../../workflows/errors";
import { RewindRequestSchema, WorkflowRevisionSchema } from "../../workflows/schemas";
import { revisionResponse, workflowService } from "../../workflows/service";

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
            description: "The draft's workflow id (UUID v7).",
            schema: WorkflowRevisionSchema.properties.revisionId,
        },
    ],
    responses: {
        "200": {
            description:
                "The draft now shows the target content: a new revision carrying the target's exact bytes (or the unchanged current revision when the target is current)",
            schemaName: "WorkflowRevision",
        },
        "400": {
            description: "The request body is not a rewind envelope with a targetRevisionId",
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
export const handler: FeatureHandler = async (c: Context) => {
    try {
        const workflowId = c.req.param("workflowId") ?? "";
        let body: unknown;
        try {
            body = await c.req.json();
        } catch {
            throw new WorkflowApiError(
                invalidWorkflowInput(
                    "The rewind request body must be a JSON object with a targetRevisionId member",
                ),
            );
        }
        const targetRevisionId =
            typeof body === "object" && body !== null && !Array.isArray(body)
                ? (body as Record<string, unknown>).targetRevisionId
                : undefined;
        if (typeof targetRevisionId !== "string" || targetRevisionId === "") {
            throw new WorkflowApiError(
                invalidWorkflowInput(
                    "The rewind request body must carry a non-empty targetRevisionId string",
                ),
            );
        }
        const result = await workflowService().rewind(workflowId, targetRevisionId);
        switch (result.outcome) {
            case "rewound":
            case "no-op":
                return c.json(revisionResponse(result.revision));
            case "target-not-found":
                throw new WorkflowApiError(
                    revisionNotFound(
                        `Revision ${targetRevisionId} of workflow ${workflowId} does not exist`,
                    ),
                );
            case "not-found":
                throw new WorkflowApiError(notFound(`Workflow ${workflowId} does not exist`));
        }
    } catch (error) {
        return workflowErrorResponse(c, error);
    }
};
