import type { FeatureHandler, FeatureRoute, FeatureSchemas } from "@rostrum/server/loader";
import type { Context } from "hono";
import { ErrorResponseSchema } from "../../schemas";
import type { Services } from "../../services";
import {
    WorkflowApiError,
    workflowErrorResponse,
    workflowNotFound,
    workflowRevisionConflict,
} from "../../workflows/errors";
import { readRequestBody } from "../../workflows/request-body";
import {
    revisionResponse,
    WorkflowIdSchema,
    WorkflowRevisionSchema,
} from "../../workflows/schemas";
import { SaveRevisionRequestSchema } from "./save.schema";

/**
 * Route binding for saving a revision. The request body's `baseRevision`
 * carries the id of the revision the client last saw; the server commits
 * only when it is still the draft's current revision.
 */
export const route: FeatureRoute = {
    method: "PUT",
    path: "/:workflowId/revisions",
    requestBody: {
        description:
            "The save request body: the base revision the client last saw, an optional revision name, and the workflow document. A document that omits the id gets the addressed workflow's id injected.",
        required: true,
        schemaName: "SaveRevisionRequest",
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
            description: "The revision was stored and is the draft's current revision",
            schemaName: "WorkflowRevision",
        },
        "400": {
            description:
                "The body is not a valid save request, or the document is not syntactically valid workflow JSON",
            schemaName: "ErrorResponse",
        },
        "404": { description: "The workflow does not exist", schemaName: "ErrorResponse" },
        "409": {
            description:
                "The saved base revision is stale (code revision_conflict, body carries currentRevision and its findings), or the document's embedded id disagrees with the addressed workflow (code identity_conflict)",
            schemaName: "ErrorResponse",
        },
    },
};

/** OpenAPI components contributed by this slice. */
export const schema: FeatureSchemas = {
    SaveRevisionRequest: SaveRevisionRequestSchema,
    WorkflowRevision: WorkflowRevisionSchema,
    ErrorResponse: ErrorResponseSchema,
};

/**
 * Serves PUT /workflows/:workflowId/revisions. Stores the submitted
 * document — with the workflow id injected when the document omits it —
 * as a new revision with its validation findings snapshot.
 */
export const createHandler =
    (services: Services): FeatureHandler =>
    async (c: Context) => {
        try {
            const workflowId = c.req.param("workflowId") ?? "";
            const { request, documentText } = await readRequestBody(c, SaveRevisionRequestSchema);
            const result = await services.workflows.saveRevision(
                workflowId,
                documentText,
                request.baseRevision,
                request.name ?? null,
            );
            switch (result.outcome) {
                case "saved":
                    return c.json(revisionResponse(result.revision));
                case "conflict":
                    throw new WorkflowApiError(workflowRevisionConflict(result.currentRevision));
                case "not-found":
                    throw new WorkflowApiError(
                        workflowNotFound(`Workflow ${workflowId} does not exist`),
                    );
            }
        } catch (error) {
            return workflowErrorResponse(c, error);
        }
    };
