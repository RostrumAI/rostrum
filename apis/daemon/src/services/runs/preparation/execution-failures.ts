/** @fileoverview Builds and orders the located failures preparation reports. */

import type { ExecutionFailure, FailureCode } from "@rostrum/workflow/execution";

/**
 * Builds the failure a refusal reports for one problem, located by its
 * JSON Pointer and, when a step is responsible, attributed to that step.
 */
export function createFailure(
    code: FailureCode,
    path: string,
    message: string,
    stepId?: string,
): ExecutionFailure {
    const built: ExecutionFailure = { code, message, path };
    if (stepId !== undefined) {
        built.stepId = stepId;
    }
    return built;
}

/** Orders failures by pointer, then code, so the same problems always read the same way. */
export function sortFailures(failures: ExecutionFailure[]): ExecutionFailure[] {
    return [...failures].sort((a, b) => {
        if (a.path !== b.path) {
            return a.path < b.path ? -1 : 1;
        }
        if (a.code !== b.code) {
            return a.code < b.code ? -1 : 1;
        }
        return 0;
    });
}
