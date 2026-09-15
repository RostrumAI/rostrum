/** @fileoverview Workflow validation service. */

import type { Static } from "typebox";
import { defineControlService } from "../../define";
import { ErrorResponseSchema } from "../../schemas";
import { CONTROL_API_TAG } from "../../tags";
import { PermissiveWorkflowDocumentSchema, ValidateResponseSchema } from "../../workflows/schemas";

/**
 * Serves POST /api/workflows/validate. Runs the same strict parse and
 * validation a draft save runs and returns the same findings in the same
 * order, without creating anything: validation findings answer 200 even when
 * they block publication, so a caller can inspect a draft's findings without
 * saving it.
 */
export const validateWorkflow = defineControlService({
    method: "POST",
    path: "/api/workflows/validate",
    request: {
        body: PermissiveWorkflowDocumentSchema,
        bodyDescription: "The raw workflow JSON document to validate.",
    },
    openapi: {
        operationId: "validateWorkflow",
        summary: "Validate a workflow document",
        tags: [CONTROL_API_TAG.WORKFLOWS],
    },
    responses: {
        200: {
            description: "Validation findings for the submitted document; nothing is saved",
            body: ValidateResponseSchema,
        },
        400: {
            description: "The document is not syntactically valid workflow JSON",
            body: ErrorResponseSchema,
        },
    },
    schemas: {
        ValidateResponse: ValidateResponseSchema,
        WorkflowDocument: PermissiveWorkflowDocumentSchema,
        ErrorResponse: ErrorResponseSchema,
    },
    handler: async (request, response, context) => {
        const outcome = await context.workflows.validate(request.bodyText);
        const validated: Static<typeof ValidateResponseSchema> = {
            findings: [...outcome.findings],
            validForPublication: outcome.validForPublication,
        };
        return response.json(validated);
    },
});
