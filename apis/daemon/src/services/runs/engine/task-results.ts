/** @fileoverview Validates what the task executor returns before the engine commits it. */

import { escapePointerToken } from "@rostrum/workflow";
import type { ExecutionFailure } from "@rostrum/workflow/execution";
import { deepFreeze } from "../owned-values";
import type { PreparedTaskStep } from "../preparation/prepared-workflow";
import type { TaskWorkResult } from "../tasks/task-executor";

/** The identity a task's result must carry back: its run and the dispatched work. */
export interface DispatchIdentity {
    /** The run the work belongs to. */
    readonly runId: string;
    /** The work the engine dispatched. */
    readonly workId: string;
}

/** A task output that passed every check, or the first failure found. */
export type TaskOutputCheck =
    | {
          /** The output satisfies the operation's schema and the step's declarations. */
          readonly ok: true;
          /** An owned, deep-frozen copy of the output, detached from what the executor returned. */
          readonly output: Readonly<Record<string, unknown>>;
      }
    | {
          /** The output can't be committed. */
          readonly ok: false;
          /** The located `invalid_output` failure. */
          readonly failure: ExecutionFailure;
      };

/**
 * Returns why a settled task failed, or undefined when it returned
 * output. A rejected executor, or a result for different work, is an
 * `execution_error`. A task failure is trusted only when its code is
 * `task_error` or one the operation declares and its pointer is relative
 * to the step; it is then located under the step's path.
 */
export function getTaskFailure(
    step: PreparedTaskStep,
    dispatched: DispatchIdentity,
    result: TaskWorkResult | undefined,
): ExecutionFailure | undefined {
    if (!result) {
        return {
            code: "execution_error",
            message: "The task executor failed",
            path: step.path,
            stepId: step.id,
        };
    }
    if (result.runId !== dispatched.runId || result.workId !== dispatched.workId) {
        return {
            code: "execution_error",
            message: "The task's result doesn't identify the dispatched work",
            path: step.path,
            stepId: step.id,
        };
    }
    if (result.ok) {
        return undefined;
    }

    // Only codes the operation declares, and pointers relative to the step, are trusted.
    const { code, message, path } = result.failure;
    const declared = code === "task_error" || step.operation.failureCodes.includes(code);
    if (!declared || (path !== "" && !path.startsWith("/"))) {
        return {
            code: "execution_error",
            message: "The task reported a failure its operation doesn't declare",
            path: step.path,
            stepId: step.id,
        };
    }
    return { code, message, path: `${step.path}${path}`, stepId: step.id };
}

/**
 * Validates a task's output against the operation's output schema and
 * the step's declared outputs, on an owned copy, so later changes to the
 * returned object can't reach what was checked. Output that can't be
 * copied or isn't an object fails.
 */
export function checkTaskOutput(step: PreparedTaskStep, output: unknown): TaskOutputCheck {
    const outputPath = `${step.path}/outputs`;

    // Copy first; a value structured cloning refuses is checked as missing.
    let owned: unknown;
    try {
        owned = structuredClone(output);
    } catch {
        owned = undefined;
    }

    // The operation's schema applies to the whole output, then each declaration to its member.
    const failures = step.outputCheck(owned, {
        path: outputPath,
        code: "invalid_output",
        stepId: step.id,
    });
    if (failures.length === 0 && isRecord(owned)) {
        for (const [name, check] of step.declaredOutputs) {
            const value = Object.getOwnPropertyDescriptor(owned, name)?.value;
            failures.push(
                ...check(value, {
                    path: `${outputPath}/${escapePointerToken(name)}`,
                    code: "invalid_output",
                    stepId: step.id,
                }),
            );
        }
    }

    const [first] = failures;
    if (first || !isRecord(owned)) {
        return {
            ok: false,
            failure: first ?? {
                code: "invalid_output",
                message: "The task's output isn't an object",
                path: outputPath,
                stepId: step.id,
            },
        };
    }
    return { ok: true, output: deepFreeze(owned) };
}

/** True for a plain object, the only shape a task may commit as output; arrays and null are not. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
