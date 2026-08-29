import { Type } from "typebox";
import { WorkflowDocumentSchema } from "../../workflows/schemas";

/**
 * The body of POST /workflows: the document to store plus an optional
 * display label for the first revision. The envelope is a body member, so
 * the operation needs no headers.
 */
export const CreateDraftRequestSchema = Type.Object(
    {
        name: Type.Optional(
            Type.Union([Type.String(), Type.Null()], {
                description: "Optional display label for the first revision.",
            }),
        ),
        document: WorkflowDocumentSchema,
    },
    { additionalProperties: false },
);
