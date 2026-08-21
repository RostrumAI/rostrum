import type { TSchema } from "typebox";
import { Compile, type Validator } from "typebox/compile";
import type { Finding } from "../../findings";
import type { ValidationContext } from "../validation-context";
import type { ValidationStage } from "../validation-stage";

/** Stable code for a failed `required` keyword, emitted once per missing member. */
const REQUIRED_FIELD_CODE = "workflow.shape.required-field";

/** Maps each failed JSON Schema keyword to its stable shape code. */
const CODE_BY_KEYWORD: Record<string, string> = {
  required: "workflow.shape.required-field",
  additionalProperties: "workflow.shape.unknown-field",
  type: "workflow.shape.type",
  pattern: "workflow.shape.format",
  format: "workflow.shape.format",
  minItems: "workflow.shape.constraint",
  maxItems: "workflow.shape.constraint",
  minLength: "workflow.shape.constraint",
  maxLength: "workflow.shape.constraint",
  minimum: "workflow.shape.constraint",
  maximum: "workflow.shape.constraint",
  exclusiveMaximum: "workflow.shape.constraint",
  minProperties: "workflow.shape.constraint",
  maxProperties: "workflow.shape.constraint",
};

/**
 * Stage 2: document shape, enforced by the interface version's TypeBox
 * schema through `Schema.Compile` (JSON Schema 2020-12).
 *
 * Required fields, types, UUID v7 formats, `additionalProperties: false`,
 * array bounds, and `maxIterations >= 1` are schema-level rules. Each
 * TypeBox error maps to a `workflow.shape.*` code with the schema path
 * and keyword in `details`; unknown fields surface here as blocking
 * `workflow.shape.unknown-field` findings (E1-S2).
 */
export class ShapeStage implements ValidationStage {
  readonly id = "shape";
  readonly prerequisites: readonly string[] = ["version"];

  private readonly compiled: Validator;

  /** Constructs the stage and compiles the document schema once. */
  constructor(documentSchema: TSchema) {
    this.compiled = Compile(documentSchema);
  }

  /** Reports every schema violation as a blocking shape finding. */
  run(context: ValidationContext): Finding[] {
    const findings: Finding[] = [];
    for (const error of this.compiled.Errors(context.document)) {
      // A failed `required` keyword points at the parent object; point
      // each finding at the member that is missing instead.
      if (error.keyword === "required") {
        const properties =
          (error.params as { requiredProperties?: string[] }).requiredProperties ?? [];
        for (const property of properties) {
          findings.push(
            context.findings.create({
              code: REQUIRED_FIELD_CODE,
              message: error.message,
              path: `${error.instancePath}/${property}`,
              details: {
                schemaPath: error.schemaPath,
                keyword: error.keyword,
                params: error.params as Record<string, unknown>,
              },
            }),
          );
        }
        continue;
      }
      findings.push(
        context.findings.create({
          code: CODE_BY_KEYWORD[error.keyword] ?? "workflow.shape.invalid",
          message: error.message,
          path: error.instancePath,
          details: {
            schemaPath: error.schemaPath,
            keyword: error.keyword,
            params: error.params as Record<string, unknown>,
          },
        }),
      );
    }
    return findings;
  }
}
