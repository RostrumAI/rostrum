/** @fileoverview Workflow revision-save service. */

import { Type } from "typebox";
import { defineControlService } from "../../define";
import { ErrorResponse } from "../../schemas";
import { CONTROL_API_TAG } from "../../tags";
import {
    WorkflowApiError,
    workflowNotFound,
    workflowRevisionConflict,
} from "../../workflows/errors";
import { extractDocumentText } from "../../workflows/request-body";
import { revisionResponse, WorkflowIdSchema, WorkflowRevision } from "../../workflows/schemas";
import { SaveRevisionRequest } from "./save.schema";

/**
 * Serves PUT /api/workflows/:workflowId/revisions. The request body's
 * `baseRevision` carries the id of the revision the client last saw, and the
 * save commits only while it is still the draft's current revision; the
 * submitted document is stored, with the workflow id injected when the
 * document omits it.
 */
export const saveWorkflowRevision = defineControlService({
    method: "PUT",
    path: "/api/workflows/:workflowId/revisions",
    request: {
        body: SaveRevisionRequest,
        params: Type.Object({ workflowId: WorkflowIdSchema }),
        paramsDescriptions: { workflowId: "The draft's workflow id." },
        bodyDescription:
            "The save request body: the base revision the client last saw, an optional revision name, and the workflow document. A document that omits the id gets the addressed workflow's id injected.",
    },
    openapi: {
        operationId: "saveWorkflowRevision",
        summary: "Save a workflow revision",
        tags: [CONTROL_API_TAG.WORKFLOWS],
    },
    responses: {
        200: {
            description: "The revision was stored and is the draft's current revision",
            body: WorkflowRevision,
        },
        400: {
            description:
                "The body is not a valid save request, or the document is not syntactically valid workflow JSON",
            body: ErrorResponse,
        },
        404: { description: "The workflow does not exist", body: ErrorResponse },
        409: {
            description:
                "The saved base revision is stale (code revision_conflict, body carries currentRevision and its findings), or the document's embedded id disagrees with the addressed workflow (code identity_conflict)",
            body: ErrorResponse,
        },
    },
    handler: async (request, response, context) => {
        const { workflowId } = request.params;
        const result = await context.workflows.saveRevision(
            workflowId,
            extractDocumentText(request.bodyText),
            request.body.baseRevision,
            request.body.name ?? null,
        );

        // Only a committed save answers with the revision; a stale base
        // revision and an unknown workflow are errors the app maps.
        switch (result.outcome) {
            case "saved":
                return response.json(revisionResponse(result.revision));
            case "conflict":
                throw new WorkflowApiError(workflowRevisionConflict(result.currentRevision));
            case "workflow-not-found":
                throw new WorkflowApiError(
                    workflowNotFound(`Workflow ${workflowId} does not exist`),
                );
        }
    },
});
