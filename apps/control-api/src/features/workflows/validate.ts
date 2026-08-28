import type { Context } from "hono";
import type { FeatureHandler, FeatureRoute, FeatureSchemas } from "../../loader";
import { ErrorResponseSchema } from "../../schemas";
import { workflowErrorResponse } from "../../workflows/errors";
import { ValidateResponseSchema, WorkflowDocumentSchema } from "../../workflows/schemas";
import { workflowService } from "../../workflows/service";

/**
 * Route binding for explicit validation. Parse failures answer 400 with
 * the parse issues as findings; validation findings answer 200 even when
 * they block publication, so a caller can inspect a draft's findings
 * without saving anything.
 */
export const route: FeatureRoute = {
    method: "POST",
    path: "/validate",
    requestBody: {
        description: "The raw workflow JSON document to validate.",
        required: true,
        schemaName: "WorkflowDocument",
    },
    responses: {
        "200": {
            description: "Validation findings for the submitted document; nothing is saved",
            schemaName: "ValidateResponse",
        },
        "400": {
            description: "The document is not syntactically valid workflow JSON",
            schemaName: "ErrorResponse",
        },
    },
};

/** OpenAPI components contributed by this slice. */
export const schema: FeatureSchemas = {
    ValidateResponse: ValidateResponseSchema,
    WorkflowDocument: WorkflowDocumentSchema,
    ErrorResponse: ErrorResponseSchema,
};

/**
 * Serves POST /workflows/validate. Runs the same strict parse and
 * validation a draft save runs, and returns the same findings in the same
 * order, without creating anything.
 */
export const handler: FeatureHandler = async (c: Context) => {
    try {
        const bytes = new Uint8Array(await c.req.arrayBuffer());
        const outcome = await workflowService().validate(bytes);
        return c.json({
            findings: outcome.findings,
            validForPublication: outcome.validForPublication,
        });
    } catch (error) {
        return workflowErrorResponse(c, error);
    }
};
