import type { TLocalizedValidationError } from "typebox/error";

/**
 * The stable finding shape. POC-thin: the full findings contract (blocking
 * rules, line/column, related locations, ordering) is decided by E1-S2. The
 * `code` mapping here is the seam E1-S2 and the validator build on.
 */
export interface Finding {
  /** Stable machine-readable code, e.g. `typebox.required`. */
  code: string;
  /** Human-readable explanation. */
  message: string;
  /** Whether the finding prevents publication. Provisional: all POC findings block. */
  blocking: boolean;
  /** JSON Pointer (instancePath) of the offending part. */
  path: string;
}

const CODE_PREFIX = "typebox";

/**
 * Maps a JSON Schema validation keyword to a stable finding code. Keyword
 * names come from the schema dialect itself, so the mapping is stable across
 * TypeBox and native JSON Schema validation.
 */
export function findingCode(keyword: string): string {
  return `${CODE_PREFIX}.${keyword}`;
}

export function findingFromError(error: TLocalizedValidationError): Finding {
  const base = error.instancePath || "/";
  let path = base;
  if (error.keyword === "additionalProperties") {
    // TypeBox reports the object instancePath; point at the offending key.
    const additional = (error.params as { additionalProperties?: string[] })
      .additionalProperties?.[0];
    if (additional) {
      path = base === "/" ? `/${additional}` : `${base}/${additional}`;
    }
  }
  return {
    code: findingCode(error.keyword),
    message: error.message,
    blocking: true,
    path,
  };
}

export function findingsFromErrors(errors: readonly TLocalizedValidationError[]): Finding[] {
  return errors.map(findingFromError);
}
