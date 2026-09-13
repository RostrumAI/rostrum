/** @fileoverview Workflow publication feature slice. */

import type { FeatureHandler, FeatureRoute, FeatureSchemas } from "@rostrum/server/loader";
import type { Context } from "hono";
import type { Static } from "typebox";
import { ErrorResponseSchema } from "../../schemas";
import type { ServiceAccessor } from "../../services";
import {
    WorkflowApiError,
    workflowErrorResponse,
    workflowNotFound,
    workflowNotValid,
    workflowRevisionNotFound,
} from "../../workflows/errors";
import { PublishResponseSchema, WorkflowIdSchema } from "../../workflows/schemas";

/** Route binding for publishing the draft's current revision. */
export const route: FeatureRoute = {
    method: "POST",
    path: "/:workflowId/publish",
    parameters: [
        {
            name: "workflowId",
            in: "path",
            description: "The draft's workflow id.",
            schema: WorkflowIdSchema,
        },
    ],
    responses: {
        "201": {
            description:
                "The current revision was published and stored as an immutable publication",
            schemaName: "PublishResponse",
        },
        "200": {
            description:
                "The current revision was already published: the response is identical and idempotent",
            schemaName: "PublishResponse",
        },
        "404": {
            description:
                "The workflow does not exist (code not_found), or its current revision does not (code revision_not_found)",
            schemaName: "ErrorResponse",
        },
        "422": {
            description:
                "The current revision has blocking validation findings; nothing is created and the body carries the findings",
            schemaName: "ErrorResponse",
        },
    },
};

/** OpenAPI components contributed by this slice. */
export const schema: FeatureSchemas = {
    PublishResponse: PublishResponseSchema,
    ErrorResponse: ErrorResponseSchema,
};

/**
 * Serves POST /workflows/:workflowId/publish. Re-runs validation on the
 * stored content — the same findings and ordering a save returned — then
 * stores the canonical text with its digest under the next publication number.
 */
export const createHandler =
    (getServices: ServiceAccessor): FeatureHandler =>
    async (c: Context) => {
        try {
            const workflowId = c.req.param("workflowId") ?? "";
            const result = await getServices(c).workflows.publish(workflowId);
            switch (result.outcome) {
                case "published":
                case "already-published": {
                    const body: Static<typeof PublishResponseSchema> = {
                        workflowId,
                        publicationNumber: result.publicationNumber,
                        workflowFormatVersion: result.workflowFormatVersion,
                        digest: result.digest,
                    };
                    return c.json(body, result.outcome === "published" ? 201 : 200);
                }
                case "blocking-findings":
                    throw new WorkflowApiError(workflowNotValid(result.findings));
                case "not-found":
                    throw new WorkflowApiError(
                        workflowNotFound(`Workflow ${workflowId} does not exist`),
                    );
                case "revision-not-found":
                    throw new WorkflowApiError(
                        workflowRevisionNotFound(
                            `The current revision of workflow ${workflowId} does not exist`,
                        ),
                    );
            }
        } catch (error) {
            return workflowErrorResponse(c, error);
        }
    };
