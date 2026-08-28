import type { Context } from "hono";
import type { FeatureHandler, FeatureRoute, FeatureSchemas } from "../../loader";
import { ErrorResponseSchema } from "../../schemas";
import { workflowErrorResponse } from "../../workflows/errors";
import {
    RevisionNameHeaderSchema,
    WorkflowDocumentSchema,
    WorkflowRevisionSchema,
} from "../../workflows/schemas";
import { revisionResponse, workflowService } from "../../workflows/service";

/**
 * Route binding for draft creation: the collection route of the workflow
 * area. Creation is the first save — the response is the draft's first
 * revision, carrying the minted workflow id injected into the stored
 * document.
 */
export const route: FeatureRoute = {
    method: "POST",
    path: "/",
    requestBody: {
        description:
            "The raw workflow JSON document. Any id it carries is replaced with the server-minted one.",
        required: true,
        schemaName: "WorkflowDocument",
    },
    parameters: [
        {
            name: "Revision-Name",
            in: "header",
            required: false,
            description: "Optional display label for the first revision.",
            schema: RevisionNameHeaderSchema,
        },
    ],
    responses: {
        "201": {
            description: "The draft was created and its first revision stored",
            schemaName: "WorkflowRevision",
        },
        "400": {
            description: "The document is not syntactically valid workflow JSON",
            schemaName: "ErrorResponse",
        },
        "409": {
            description: "The minted workflow id collided with an existing draft",
            schemaName: "ErrorResponse",
        },
    },
};

/** OpenAPI components contributed by this slice. */
export const schema: FeatureSchemas = {
    WorkflowRevision: WorkflowRevisionSchema,
    WorkflowDocument: WorkflowDocumentSchema,
    ErrorResponse: ErrorResponseSchema,
};

/**
 * Serves POST /workflows. Mints the draft's UUID v7 id, injects it into
 * the stored document, and stores the submitted bytes as the first
 * revision with their validation findings snapshot.
 */
export const handler: FeatureHandler = async (c: Context) => {
    try {
        const bytes = new Uint8Array(await c.req.arrayBuffer());
        const name = c.req.header("Revision-Name") ?? null;
        const created = await workflowService().createDraft(bytes, name);
        return c.json(revisionResponse(created.revision), 201);
    } catch (error) {
        return workflowErrorResponse(c, error);
    }
};
