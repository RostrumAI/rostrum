import { type Static, Type } from "typebox";

/**
 * PostgreSQL cannot store NUL bytes (U+0000) in text columns, and jsonb
 * content is text. The workflow contract therefore rejects NUL inside
 * strings; the pattern is part of the schema so the OpenAPI document carries
 * it and clients see the same rule.
 */
const noNul = { pattern: "^[^\\u0000]*$" } as const;

/**
 * The proof-of-concept workflow schema. One schema language (JSON Schema
 * 2020-12 via TypeBox) for the workflow interface, the API contract, and the
 * OpenAPI document — no conversion layer (Decision e1-s0). The TypeScript
 * types are derived from the schema so the two cannot drift.
 */
export const TaskStepSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, ...noNul }),
    type: Type.Literal("task"),
    description: Type.Optional(Type.String(noNul)),
    next: Type.Optional(Type.String(noNul)),
  },
  { additionalProperties: false },
);

export const ResultStepSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, ...noNul }),
    type: Type.Literal("result"),
  },
  { additionalProperties: false },
);

export const WorkflowStepSchema = Type.Union([TaskStepSchema, ResultStepSchema]);

export const WorkflowSchema = Type.Object(
  {
    interfaceVersion: Type.Literal("v1"),
    id: Type.String({ minLength: 1, ...noNul }),
    name: Type.String({ minLength: 1, ...noNul }),
    createdAt: Type.String({ format: "date-time", ...noNul }),
    start: Type.String({ minLength: 1, ...noNul }),
    steps: Type.Array(WorkflowStepSchema),
  },
  { additionalProperties: false },
);

export type TaskStep = Static<typeof TaskStepSchema>;
export type ResultStep = Static<typeof ResultStepSchema>;
export type WorkflowStep = Static<typeof WorkflowStepSchema>;
export type Workflow = Static<typeof WorkflowSchema>;
