import { Type } from "typebox";

/**
 * The workflow interface version token served by the Control API: an
 * exact-match string, never a numeric ordering. v1 is the literal "v1",
 * and the API selects rules by exact match.
 */
export const INTERFACE_VERSION = "v1";

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

/** The single error shape for every Control API error response. */
export const ErrorResponseSchema = Type.Object(
    {
        code: Type.String(),
        message: Type.String(),
        findings: Type.Array(FindingSchema),
        currentRevision: Type.Optional(
            Type.String({
                description:
                    "The draft's current revision id, present on revision conflicts so a client can retry against it.",
            }),
        ),
    },
    { additionalProperties: false },
);
