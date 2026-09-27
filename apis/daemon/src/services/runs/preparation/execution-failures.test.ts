import { describe, expect, test } from "bun:test";
import { createFailure, sortFailures } from "./execution-failures";

describe("createFailure", () => {
    // Proves a step is attached only when one is responsible, so the member never reads undefined.
    test("attributes the step only when given", () => {
        expect(createFailure("invalid_document", "/firstNode", "missing")).toEqual({
            code: "invalid_document",
            message: "missing",
            path: "/firstNode",
        });
        expect(Object.hasOwn(createFailure("invalid_document", "", "m"), "stepId")).toBe(false);
        expect(createFailure("invalid_config", "/steps/0", "m", "step-1").stepId).toBe("step-1");
    });
});

describe("sortFailures", () => {
    // Proves failures order by pointer, then code, whatever order they were found in.
    test("orders by path then code", () => {
        const found = [
            createFailure("missing_input", "/inputs/b", "m"),
            createFailure("undeclared_input", "/inputs/a", "m"),
            createFailure("invalid_input", "/inputs/a", "m"),
        ];
        expect(sortFailures(found).map((failure) => [failure.path, failure.code])).toEqual([
            ["/inputs/a", "invalid_input"],
            ["/inputs/a", "undeclared_input"],
            ["/inputs/b", "missing_input"],
        ]);
    });

    // Proves sorting returns a new list and leaves the caller's list as it was.
    test("doesn't reorder its input", () => {
        const found = [
            createFailure("missing_input", "/b", "m"),
            createFailure("missing_input", "/a", "m"),
        ];
        sortFailures(found);
        expect(found.map((failure) => failure.path)).toEqual(["/b", "/a"]);
    });
});
