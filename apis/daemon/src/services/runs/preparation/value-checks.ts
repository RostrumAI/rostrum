/** @fileoverview Value checks that report located execution failures. */

import type { ValueCheck } from "@rostrum/workflow";
import type { ExecutionFailure, FailureCode } from "@rostrum/workflow/execution";

/** Where a checked value sits and what a failure of it means. */
export interface CheckLocation {
    /** JSON Pointer to the value in the publication or invocation. */
    readonly path: string;
    /** The failure code each issue is reported with. */
    readonly code: FailureCode;
    /** The step responsible, when one is. */
    readonly stepId?: string;
}

/** Checks one value and returns every located failure; empty means valid. */
export type ValueChecker = (value: unknown, location: CheckLocation) => ExecutionFailure[];

/**
 * Wraps a compiled schema check so its issues become located execution
 * failures. An evaluator that throws is reported as a sanitized
 * `execution_error` at the value's location instead of escaping, because
 * the exception text could include the value.
 */
export function createValueChecker(check: ValueCheck): ValueChecker {
    return (value, location) => {
        let issues: ReturnType<ValueCheck>;
        try {
            issues = check(value);
        } catch {
            // The evaluator's own error is dropped: it may echo the value.
            return [
                createFailureAt(
                    location,
                    location.path,
                    "execution_error",
                    "The value couldn't be checked",
                ),
            ];
        }
        return issues.map((issue) =>
            createFailureAt(
                location,
                `${location.path}${issue.path}`,
                location.code,
                issue.message,
            ),
        );
    };
}

/** Builds one failure at a location, attributing it to the location's step when there is one. */
function createFailureAt(
    location: CheckLocation,
    path: string,
    code: FailureCode,
    message: string,
): ExecutionFailure {
    const failure: ExecutionFailure = { code, message, path };
    if (location.stepId !== undefined) {
        failure.stepId = location.stepId;
    }
    return failure;
}
