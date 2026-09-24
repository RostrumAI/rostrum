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
