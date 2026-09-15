import { defineSchema } from "@rostrum/server/schema";
import { Type } from "typebox";
import { PermissiveWorkflowDocumentSchema, UUID_PATTERN } from "../../workflows/schemas";

/**
 * The body of PUT /workflows/:workflowId/revisions: the optimistic base
 * revision, an optional display label, and the document to store. All
 * save inputs travel in the body, so the operation needs no headers.
 */
export const SaveRevisionRequestSchema = Type.Object(
    {
        baseRevision: Type.String({
            pattern: UUID_PATTERN,
            description: "The revision id the client last saw; the save commits only against it.",
        }),
        name: Type.Optional(
            Type.Union([Type.String(), Type.Null()], {
                description: "Optional display label for the new revision.",
            }),
        ),
        document: PermissiveWorkflowDocumentSchema,
    },
    { additionalProperties: false },
);

/** The `SaveRevisionRequest` component: the base revision and document a save carries. */
export const SaveRevisionRequest = defineSchema("SaveRevisionRequest", SaveRevisionRequestSchema);
