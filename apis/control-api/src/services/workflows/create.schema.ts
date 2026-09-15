import { defineSchema } from "@rostrum/server/schema";
import { Type } from "typebox";
import { PermissiveWorkflowDocumentSchema } from "../../workflows/schemas";

/**
 * The body of POST /workflows: the document to store plus an optional
 * display label for the first revision. All creation inputs travel in the
 * body, so the operation needs no headers.
 */
export const CreateDraftRequestSchema = Type.Object(
    {
        name: Type.Optional(
            Type.Union([Type.String(), Type.Null()], {
                description: "Optional display label for the first revision.",
            }),
        ),
        document: PermissiveWorkflowDocumentSchema,
    },
    { additionalProperties: false },
);

/** The `CreateDraftRequest` component: the document and optional label a creation sends. */
export const CreateDraftRequest = defineSchema("CreateDraftRequest", CreateDraftRequestSchema);
