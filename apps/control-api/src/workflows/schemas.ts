import type { StoredRevision } from "@rostrum/database";
import { type Static, Type } from "typebox";

/**
 * Request and response schemas shared by the workflow feature slices.
 * Every slice re-exports the ones it documents under the same component
 * name; the loader keeps one component per distinct schema object, so the
 * generated contract carries a single definition.
 */

/**
 * A single validation finding, mirroring the shared workflow library's
 * `Finding` exactly: stable code, human-readable message, blocking flag,
 * JSON Pointer, and the optional location, cross-reference, and structured
 * detail members the library attaches when source text is available.
 */
export const FindingSchema = Type.Object(
    {
        code: Type.String(),
        message: Type.String(),
        blocking: Type.Boolean(),
        path: Type.String(),
        line: Type.Optional(Type.Integer({ description: "One-based line in the saved text." })),
        column: Type.Optional(Type.Integer({ description: "One-based column in the saved text." })),
        relatedLocations: Type.Optional(
            Type.Array(
                Type.Object(
                    {
                        path: Type.String(),
                        message: Type.String(),
                    },
                    { additionalProperties: false },
                ),
            ),
        ),
        details: Type.Optional(
            Type.Record(Type.String(), Type.Unknown(), {
                description:
                    "Structured context an automated author can repair without parsing the message.",
            }),
        ),
    },
    { additionalProperties: false },
);

/** The UUID shape every workflow and revision id carries. */
export const UUID_PATTERN =
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

/** The workflow id as a path parameter value. */
export const WorkflowIdSchema = Type.String({
    pattern: UUID_PATTERN,
    description: "The workflow id.",
});

/** A revision id as a path parameter or envelope member value. */
export const RevisionIdSchema = Type.String({
    pattern: UUID_PATTERN,
    description: "The revision id.",
});

/** The published version number as a path parameter value. */
export const VersionNumberSchema = Type.String({
    pattern: "^[1-9][0-9]*$",
    description: "The per-workflow published version number.",
});

/** The revision shape every draft operation returns: create, save, rewind, and both retrievals. */
export const WorkflowRevisionSchema = Type.Object(
    {
        workflowId: Type.String({
            description: "The owning draft's id.",
        }),
        revisionId: Type.String({ description: "The revision id." }),
        name: Type.Union([Type.String(), Type.Null()], {
            description: "The author's checkpoint label, when the save carried one.",
        }),
        type: Type.Union([Type.Literal("save"), Type.Literal("rewind")], {
            description:
                "How the revision came to exist: an author save or a rewind-appended copy.",
        }),
        content: Type.String({
            description:
                "The stored document text. When a save omitted the document id, the response carries the stored text with the id injected.",
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

/** The permissive document member of the request envelopes. */
export const WorkflowDocumentSchema = Type.Unknown({
    description:
        "The raw workflow JSON document. Drafts accept any syntactically valid JSON, including documents with blocking validation findings; the precise document shape lives in the workflow interface, not the transport contract.",
});

/**
 * Maps one stored revision onto the WorkflowRevision response shape, the
 * uniform body of create, save, rewind, and both revisions' retrievals.
 */
export function revisionResponse(revision: StoredRevision): Static<typeof WorkflowRevisionSchema> {
    return {
        workflowId: revision.workflowId,
        revisionId: revision.revisionId,
        name: revision.name,
        type: revision.type,
        content: revision.content,
        findings: [...revision.findings],
    };
}
