import { Type } from "typebox";

/**
 * The workflow interface version token served by the Control API (E1-S1):
 * an exact-match string, never a numeric ordering. v1 is the literal "v1",
 * and the API selects rules by exact match.
 */
export const INTERFACE_VERSION = "v1";

/**
 * A single validation finding. The element shape is provisional until E1-S2
 * defines the full findings contract; error responses carry the array empty
 * until workflow operations report findings (E1-06).
 */
export const FindingSchema = Type.Object(
    {
        code: Type.String(),
        message: Type.String(),
        blocking: Type.Boolean(),
        path: Type.String(),
    },
    { additionalProperties: false },
);

/** The single error shape for every Control API error response (E1-02 contract). */
export const ErrorResponseSchema = Type.Object(
    {
        code: Type.String(),
        message: Type.String(),
        findings: Type.Array(FindingSchema),
    },
    { additionalProperties: false },
);
