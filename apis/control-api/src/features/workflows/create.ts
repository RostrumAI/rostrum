import type { FeatureHandler, FeatureRoute, FeatureSchemas } from "@rostrum/server/loader";
import type { Context } from "hono";
import { ErrorResponseSchema } from "../../schemas";
import type { Services } from "../../services";
import { workflowErrorResponse } from "../../workflows/errors";
import { readRequestBody } from "../../workflows/request-body";
import { revisionResponse, WorkflowRevisionSchema } from "../../workflows/schemas";
import { CreateDraftRequestSchema } from "./create.schema";

/**
 * Route binding for draft creation: the collection route of the workflow
 * area. Creation is the first save — the response is the draft's first
 * revision, carrying the workflow id the server assigned and injected
 * into the stored document.
 */
export const route: FeatureRoute = {
    method: "POST",
    path: "/",
    requestBody: {
        description:
            "The creation request body: the workflow document, with an optional revision name.",
        required: true,
        schemaName: "CreateDraftRequest",
    },
    responses: {
        "201": {
            description: "The draft was created and its first revision stored",
            schemaName: "WorkflowRevision",
        },
        "400": {
            description:
                "The body is not a valid creation request, or the document is not syntactically valid workflow JSON",
            schemaName: "ErrorResponse",
        },
    },
};

/** OpenAPI components contributed by this slice. */
export const schema: FeatureSchemas = {
    CreateDraftRequest: CreateDraftRequestSchema,
    WorkflowRevision: WorkflowRevisionSchema,
    ErrorResponse: ErrorResponseSchema,
};

/**
 * Serves POST /workflows. Assigns the draft's workflow id, injects it
 * into the stored document, and stores the submitted document as the
 * first revision with its validation findings snapshot.
 */
export const createHandler =
    (services: Services): FeatureHandler =>
    async (c: Context) => {
        try {
            const { request, documentText } = await readRequestBody(c, CreateDraftRequestSchema);
            const created = await services.workflows.createDraft(
                documentText,
                request.name ?? null,
            );
            return c.json(revisionResponse(created.revision), 201);
        } catch (error) {
            return workflowErrorResponse(c, error);
        }
    };
