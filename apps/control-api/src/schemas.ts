import { Type } from "typebox";
import { FindingSchema } from "./workflows/schemas";

/**
 * The workflow interface version token served by the Control API: an
 * exact-match string, never a numeric ordering. v1 is the literal "v1",
 * and the API selects rules by exact match.
 */
export const INTERFACE_VERSION = "v1";

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
