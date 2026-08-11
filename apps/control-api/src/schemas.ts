import { WorkflowSchema } from "@rostrum/workflow-lib";
import { Type } from "typebox";

/** The single error shape for the Control API (E1-02 contract). */
export const FindingSchema = Type.Object(
  {
    code: Type.String(),
    message: Type.String(),
    blocking: Type.Boolean(),
    path: Type.String(),
  },
  { additionalProperties: false },
);

export const ErrorResponseSchema = Type.Object(
  {
    code: Type.String(),
    message: Type.String(),
    findings: Type.Array(FindingSchema),
  },
  { additionalProperties: false },
);

export const WorkflowPublishedSchema = Type.Object(
  {
    id: Type.String(),
    version: Type.Integer(),
    digest: Type.String(),
    createdAt: Type.String({ format: "date-time" }),
    workflow: WorkflowSchema,
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
    interfaceVersion: Type.String(),
  },
  { additionalProperties: false },
);

/**
 * OpenAPI components. The TypeBox schemas are embedded verbatim, so the
 * generated document round-trips the schemas unchanged (E1-S0 row 3).
 */
export const Schemas = {
  Workflow: WorkflowSchema,
  WorkflowPublished: WorkflowPublishedSchema,
  ErrorResponse: ErrorResponseSchema,
  Finding: FindingSchema,
  Health: HealthSchema,
  Version: VersionSchema,
} as const;
