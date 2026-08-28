import { Type } from "typebox";
import { FindingSchema } from "../schemas";

/**
 * Response and request-envelope schemas shared by the workflow feature
 * slices. Every slice re-exports the ones it documents under the same
 * component name; the loader keeps one component per distinct schema
 * object, so the generated contract carries a single definition.
 */

/** The revision shape every draft operation returns: create, save, rewind, and both retrievals. */
export const WorkflowRevisionSchema = Type.Object(
    {
        workflowId: Type.String({
            description:
                "The owning draft's id. Creation returns the id the server minted and injected into the stored document.",
        }),
        revisionId: Type.String({ description: "The server-minted revision id (UUID v7)." }),
        name: Type.Union([Type.String(), Type.Null()], {
            description: "The author's checkpoint label, when the save carried one.",
        }),
        type: Type.Union([Type.Literal("save"), Type.Literal("rewind")], {
            description:
                "How the revision came to exist: an author save or a rewind-appended copy.",
        }),
        content: Type.String({
            description:
                "The exact stored bytes. When a save omitted the document id, the response carries the stored text with the id injected.",
        }),
        findings: Type.Array(FindingSchema, {
            description: "The validation findings snapshot stored with the revision.",
        }),
    },
    { additionalProperties: false },
);

/** The body of POST /workflows/validate: findings without saving. */
export const ValidateResponseSchema = Type.Object(
    {
        findings: Type.Array(FindingSchema),
        validForPublication: Type.Boolean({
            description: "True when no finding blocks publication.",
        }),
    },
    { additionalProperties: false },
);

/** The body of POST /workflows/:workflowId/publish, identical for first publish and idempotent re-publish. */
export const PublishResponseSchema = Type.Object(
    {
        workflowId: Type.String(),
        versionNumber: Type.Integer({ description: "The per-workflow published version number." }),
        interfaceVersion: Type.String({
            description: "The exact interface version token the published content satisfies.",
        }),
        digest: Type.String({
            description:
                "SHA-256 hex over the RFC 8785 canonical form of the document with name and description removed.",
        }),
    },
    { additionalProperties: false },
);

/** The body of GET /workflows/:workflowId/versions/:versionNumber. */
export const PublishedVersionResponseSchema = Type.Object(
    {
        versionNumber: Type.Integer(),
        revisionId: Type.String({
            description: "The source revision the published bytes came from.",
        }),
        interfaceVersion: Type.String(),
        digest: Type.String(),
        content: Type.String({
            description:
                "The stored canonical text (RFC 8785), full document with metadata members included. Verify by removing name and description, canonicalizing, and hashing SHA-256: the result equals digest.",
        }),
    },
    { additionalProperties: false },
);

/** The request envelope of POST /workflows/:workflowId/rewind. */
export const RewindRequestSchema = Type.Object(
    { targetRevisionId: Type.String({ description: "The revision to rewind the draft to." }) },
    { additionalProperties: false },
);

/** The `Revision-Name` header value: an optional checkpoint label. */
export const RevisionNameHeaderSchema = Type.String({
    description: "Optional display label for the revision.",
});

/** The permissive body schema of the document-carrying operations. */
export const WorkflowDocumentSchema = Type.Unknown({
    description:
        "The raw workflow JSON document. Drafts accept any syntactically valid JSON, including documents with blocking validation findings; the precise document shape lives in the workflow interface, not the transport contract.",
});
