/**
 * Shared reference grammar for the conditional and data-reference
 * stages. A binding value is a JSON literal or a reference object with
 * the exact shape `{ "ref": "<path>" }`; an object whose only key is
 * `ref` is always interpreted as a reference, never as a literal
 * (workflow interface v1, Data references).
 */

/** Matches `step.<stepId>.<outputName>`; step ids are UUID v7 strings. */
export const STEP_REF_PATTERN = /^step\.([0-9a-f-]{36})\.(.+)$/;

/**
 * The reserved output under which a loop step exposes the array of
 * collected iteration results. The workflow interface specification
 * names `results` as an implicit output of every step that declares a
 * `loop`; authors may also declare it explicitly to document the
 * element shape.
 */
export const LOOP_RESULTS_OUTPUT = "results";

/** True when the value is a reference object: an object whose only key is a string-valued `ref`. */
export function isReferenceObject(value: unknown): value is { ref: string } {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.ref !== "string") {
        return false;
    }
    return Object.keys(record).length === 1;
}
