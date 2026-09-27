/**
 * @fileoverview Tests `createValueChecker`, which turns a compiled schema
 * check's issues into located execution failures. Its output is what callers
 * see when an input or output is rejected, so paths must point at the value
 * and must not leak the value itself.
 *
 * createValueChecker:
 * - a valid value has no failures.
 * - checks the value it was given: the compiled check receives that exact
 *   value, once.
 * - locates each issue under the value's path: each issue keeps its message,
 *   uses the location's code, and prefixes its path with the value's pointer.
 * - attributes failures to the location's step: `stepId` is copied from the
 *   location.
 * - reports a throwing evaluator without its message: the result is one
 *   `execution_error` at the value's path, with no exception text.
 */

import { describe, expect, test } from "bun:test";
import type { ValueCheck } from "@rostrum/workflow";
import { createValueChecker } from "./value-checks";

/** A compiled check that reports the given issues for every value. */
function createFixedCheck(issues: ReturnType<ValueCheck>): ValueCheck {
    return () => issues;
}

describe("createValueChecker", () => {
    // Proves a value with no issues produces no failures.
    test("a valid value has no failures", () => {
        const checker = createValueChecker(createFixedCheck([]));
        expect(checker(1, { path: "/inputs/amount", code: "invalid_input" })).toEqual([]);
    });

    // Proves the compiled check receives the checked value itself, not a copy or the location.
    test("checks the value it was given", () => {
        // Records every value the compiled check is called with.
        const received: unknown[] = [];
        const checker = createValueChecker((value) => {
            received.push(value);
            return [];
        });
        const payload = { amount: 3 };
        checker(payload, { path: "/inputs/payload", code: "invalid_input" });

        // The check ran once, on the same object the caller passed.
        expect(received).toHaveLength(1);
        expect(received[0]).toBe(payload);
    });

    // Proves each issue becomes a failure located under the value's own path, with the location's code.
    test("locates each issue under the value's path", () => {
        const checker = createValueChecker(
            createFixedCheck([
                { path: "", keyword: "required", message: "Value must have required property 'b'" },
                { path: "/a", keyword: "type", message: "Value must be number" },
            ]),
        );

        // Both issues keep their messages and gain the value's pointer as a prefix.
        expect(checker({}, { path: "/inputs/payload", code: "invalid_input" })).toEqual([
            {
                code: "invalid_input",
                message: "Value must have required property 'b'",
                path: "/inputs/payload",
            },
            { code: "invalid_input", message: "Value must be number", path: "/inputs/payload/a" },
        ]);
    });

    // Proves a failure names the responsible step only when the location has one.
    test("attributes failures to the location's step", () => {
        const checker = createValueChecker(
            createFixedCheck([{ path: "", keyword: "type", message: "Value must be number" }]),
        );
        const [failure] = checker("a", {
            path: "/steps/0/outputs/value",
            code: "invalid_output",
            stepId: "step-1",
        });
        expect(failure?.stepId).toBe("step-1");
    });

    // Proves a throwing evaluator becomes a sanitized execution error that doesn't echo the value.
    test("reports a throwing evaluator without its message", () => {
        const checker = createValueChecker(() => {
            throw new Error("secret value 42");
        });
        const failures = checker("secret value 42", {
            path: "/inputs/amount",
            code: "invalid_input",
        });

        // The failure is located at the value, and nothing from the exception leaks.
        expect(failures).toEqual([
            {
                code: "execution_error",
                message: "The value couldn't be checked",
                path: "/inputs/amount",
            },
        ]);
        expect(JSON.stringify(failures)).not.toContain("secret");
    });
});
