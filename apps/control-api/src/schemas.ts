import { Type } from "typebox";

/**
 * The workflow interface version token served by the Control API (E1-S1):
 * an exact-match string, never a numeric ordering. v1 is the literal "v1",
 * and the API selects rules by exact match.
 */
export const INTERFACE_VERSION = "v1";

/**
 * A single validation finding. The element shape is provisional until E1-S2
 * defines the full findings contract; E1-02 only carries the array in the
 * error shape, always empty.
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

/** The single error shape for the Control API (E1-02 contract). */
export const ErrorResponseSchema = Type.Object(
  {
    code: Type.String(),
    message: Type.String(),
    findings: Type.Array(FindingSchema),
  },
  { additionalProperties: false },
);

export const HealthSchema = Type.Object(
  { status: Type.Literal("ok") },
  { additionalProperties: false },
);

export const VersionSchema = Type.Object(
  {
    service: Type.String(),
    version: Type.String(),
    interfaceVersion: Type.Literal(INTERFACE_VERSION),
  },
  { additionalProperties: false },
);

/**
 * OpenAPI components. The TypeBox schemas are embedded verbatim, so the
 * generated document round-trips the schemas unchanged (E1-S0 row 3).
 */
export const Schemas = {
  Health: HealthSchema,
  Version: VersionSchema,
  ErrorResponse: ErrorResponseSchema,
  Finding: FindingSchema,
} as const;
