/** @fileoverview Current workflow draft retrieval feature slice. */

import type { FeatureHandler, FeatureRoute, FeatureSchemas } from "@rostrum/server/loader";
import type { Context } from "hono";
import { ErrorResponseSchema } from "../../schemas";
import type { ServiceAccessor } from "../../services";
import { WorkflowApiError, workflowErrorResponse, workflowNotFound } from "../../workflows/errors";
import {
    revisionResponse,
    WorkflowIdSchema,
    WorkflowRevisionSchema,
} from "../../workflows/schemas";

/** Route binding for retrieving the draft's current revision. */
export const route: FeatureRoute = {
    method: "GET",
    path: "/:workflowId",
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
            description: "The draft's current revision: stored text plus findings snapshot",
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
 * the exact stored text, so findings' line and column anchor to the text
 * a client reads.
 */
export const createHandler =
    (getServices: ServiceAccessor): FeatureHandler =>
    async (c: Context) => {
        try {
            const workflowId = c.req.param("workflowId") ?? "";
            const revision = await getServices(c).workflows.getCurrentRevision(workflowId);
            if (!revision) {
                throw new WorkflowApiError(
                    workflowNotFound(`Workflow ${workflowId} does not exist`),
                );
            }
            return c.json(revisionResponse(revision));
        } catch (error) {
            return workflowErrorResponse(c, error);
        }
    };
