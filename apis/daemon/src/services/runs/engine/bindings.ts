/** @fileoverview Resolves a step's prepared bindings to the values it receives. */

import type { ExecutionFailure } from "@rostrum/workflow/execution";
import type { PreparedInput } from "../preparation/prepared-workflow";
import type { RunInputs } from "../preparation/publication-preparer";

/** What bindings resolve against in one run. */
export interface BindingContext {
    /** The run's accepted workflow inputs. */
    readonly inputs: RunInputs;
    /**
     * Returns the committed output of a completed visit of the step, or
     * undefined when the step hasn't completed in this run. Work that is
     * running or failed has no output to read.
     */
    getCompletedOutput(stepId: string): Readonly<Record<string, unknown>> | undefined;
}

/** The resolved values, or the first binding that couldn't be resolved. */
export type BindingResolution =
    | {
          /** Every binding resolved. */
          readonly ok: true;
          /** The values by input name, as own members even for names like `__proto__`. */
          readonly values: Readonly<Record<string, unknown>>;
      }
    | {
          /** A binding couldn't be resolved. */
          readonly ok: false;
          /** The located `unresolved_binding` failure. */
          readonly failure: ExecutionFailure;
      };

/**
 * Resolves a step's inputs. Literals and defaults come from the prepared
 * workflow, workflow inputs from the run, and step outputs only from
 * completed visits' committed output. A reference that doesn't resolve
 * fails; it never falls back to a default. Lookups use own members only,
 * so author-chosen names such as `constructor` or `a.b` read exactly the
 * member of that name.
 */
export function resolveBindings(
    inputs: ReadonlyMap<string, PreparedInput>,
    context: BindingContext,
    stepId: string,
): BindingResolution {
    const values: Record<string, unknown> = {};
    for (const [name, input] of inputs) {
        const resolved = resolveBinding(input, context);
        if (!resolved.found) {
            return {
                ok: false,
                failure: {
                    code: "unresolved_binding",
                    message: `The value bound to '${name}' isn't available`,
                    path: input.path,
                    stepId,
                },
            };
        }
        // A defined property stays an own member even when the name is `__proto__`.
        Object.defineProperty(values, name, {
            value: resolved.value,
            enumerable: true,
            writable: true,
            configurable: true,
        });
    }
    return { ok: true, values };
}

/** Resolves one binding, reporting whether its value is available. */
function resolveBinding(
    input: PreparedInput,
    context: BindingContext,
): { found: true; value: unknown } | { found: false } {
    const binding = input.binding;
    switch (binding.kind) {
        case "literal":
            return { found: true, value: binding.value };
        case "workflow-input":
            return context.inputs.has(binding.inputName)
                ? { found: true, value: context.inputs.get(binding.inputName) }
                : { found: false };
        case "step-output": {
            const output = context.getCompletedOutput(binding.stepId);
            return output && Object.hasOwn(output, binding.outputName)
                ? { found: true, value: output[binding.outputName] }
                : { found: false };
        }
    }
}
