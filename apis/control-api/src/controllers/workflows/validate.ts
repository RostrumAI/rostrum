/** @fileoverview Workflow validation controller. */

import type { Static } from "typebox";
import { defineControlController } from "../../http/define";
import { CONTROL_API_TAG } from "../../http/tags";
import { ErrorResponse } from "../../schemas";
import { ValidateResponse, type ValidateResponseSchema, WorkflowDocument } from "./schemas";

/**
 * Serves POST /api/workflows/validate. Runs the same strict parse and
 * validation a draft save runs and returns the same findings in the same
 * order, without creating anything: validation findings answer 200 even when
 * they block publication, so a caller can inspect a draft's findings without
 * saving it.
 */
export const validateWorkflow = defineControlController({
    method: "POST",
    path: "/api/workflows/validate",
    request: {
        body: WorkflowDocument,
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
            body: ValidateResponse,
        },
        400: {
            description: "The document is not syntactically valid workflow JSON",
            body: ErrorResponse,
        },
    },
    handler: async (request, response, context) => {
        const outcome = await context.services.workflows.validate(request.bodyText);
        const validated: Static<typeof ValidateResponseSchema> = {
            findings: [...outcome.findings],
            validForPublication: outcome.validForPublication,
        };
        return response.json(validated);
    },
});
