import type { Context } from "hono";
import { validate as isUuid, version as uuidVersion } from "uuid";
import type { FeatureHandler, FeatureRoute, FeatureSchemas } from "../../loader";
import { ErrorResponseSchema } from "../../schemas";
import {
    invalidWorkflowInput,
    notFound,
    revisionConflict,
    WorkflowApiError,
    workflowErrorResponse,
} from "../../workflows/errors";
import {
    RevisionNameHeaderSchema,
    WorkflowDocumentSchema,
    WorkflowRevisionSchema,
} from "../../workflows/schemas";
import { revisionResponse, workflowService } from "../../workflows/service";

/**
 * Route binding for saving a revision. The `Base-Revision` header carries
 * the id of the revision the client last saw; the server commits only
 * when it is still the draft's current revision.
 */
export const route: FeatureRoute = {
    method: "POST",
    path: "/:workflowId/revisions",
    requestBody: {
        description:
            "The raw workflow JSON document. A document that omits the id gets the addressed workflow's id injected.",
        required: true,
        schemaName: "WorkflowDocument",
    },
    parameters: [
        {
            name: "workflowId",
            in: "path",
            description: "The draft's workflow id (UUID v7).",
            schema: WorkflowRevisionSchema.properties.revisionId,
        },
        {
            name: "Base-Revision",
            in: "header",
            required: true,
            description: "The revision id the client last saw; the save commits only against it.",
            schema: WorkflowRevisionSchema.properties.revisionId,
        },
        {
            name: "Revision-Name",
            in: "header",
            required: false,
            description: "Optional display label for the new revision.",
            schema: RevisionNameHeaderSchema,
        },
    ],
    responses: {
        "200": {
            description: "The revision was stored and is the draft's current revision",
            schemaName: "WorkflowRevision",
        },
        "400": {
            description:
                "The document is not syntactically valid workflow JSON, or the Base-Revision header is missing or malformed",
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
    WorkflowRevision: WorkflowRevisionSchema,
    WorkflowDocument: WorkflowDocumentSchema,
    ErrorResponse: ErrorResponseSchema,
};

/**
 * Serves POST /workflows/:workflowId/revisions. Stores the exact submitted
 * bytes — with the workflow id injected when the document omits it — as a
 * new revision with its validation findings snapshot.
 */
export const handler: FeatureHandler = async (c: Context) => {
    try {
        const workflowId = c.req.param("workflowId") ?? "";
        const baseRevision = c.req.header("Base-Revision");
        if (baseRevision === undefined) {
            throw new WorkflowApiError(
                invalidWorkflowInput("The Base-Revision header is required to save a revision"),
            );
        }
        if (!isUuid(baseRevision) || uuidVersion(baseRevision) !== 7) {
            throw new WorkflowApiError(
                invalidWorkflowInput(`'${baseRevision}' is not a revision id (UUID v7)`),
            );
        }
        const bytes = new Uint8Array(await c.req.arrayBuffer());
        const name = c.req.header("Revision-Name") ?? null;
        const result = await workflowService().saveRevision(workflowId, bytes, baseRevision, name);
        switch (result.outcome) {
            case "saved":
                return c.json(revisionResponse(result.revision));
            case "conflict":
                throw new WorkflowApiError(revisionConflict(result.currentRevision));
            case "not-found":
                throw new WorkflowApiError(notFound(`Workflow ${workflowId} does not exist`));
        }
    } catch (error) {
        return workflowErrorResponse(c, error);
    }
};
