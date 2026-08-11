import type { TLocalizedValidationError } from "typebox/error";
import Schema from "typebox/schema";
import { type Workflow, WorkflowSchema } from "./schema";

const compiled = Schema.Compile(WorkflowSchema);

export type ValidationResult =
  | { ok: true; value: Workflow }
  | { ok: false; errors: TLocalizedValidationError[] };

/**
 * Validates unknown JSON against the v1 workflow schema. TypeBox `Schema.Compile`
 * is the single validation path for the API, the validator (E1-04), and the
 * conformance harnesses (E2-07, E3-08).
 */
export function validateWorkflow(value: unknown): ValidationResult {
  if (compiled.Check(value)) {
    return { ok: true, value };
  }
  return { ok: false, errors: compiled.Errors(value)[1] };
}
