import { describe, expect, test } from "bun:test";
import { checkStaticCompatibility } from "../compatibility/static-compatibility-check";
import { createDeclaredSchemaCompiler } from "../declared-schemas/declared-schema-compiler";
import { buildDocument, resultStep, taskStep } from "../testing/documents";
import { ADD_OPERATION } from "./add";
import type { OperationCatalog } from "./operation-catalog";

/** A catalog holding only `add`, so each case exercises its declaration alone. */
const CATALOG: OperationCatalog = new Map([[ADD_OPERATION.name, ADD_OPERATION]]);

/** Checks an `add` task bound to `inputs` and returns the issue kinds and paths. */
function checkAddTask(inputs: Record<string, unknown>, outputs?: Record<string, unknown>) {
    const end = resultStep();
    const task = taskStep({ config: { operation: "add" }, inputs, successors: [end.id] });
    if (outputs) {
        task.outputs = outputs;
    }
    const document = buildDocument({ steps: [task, end], firstNode: task.id });
    return checkStaticCompatibility(document, CATALOG, createDeclaredSchemaCompiler()).map(
        (issue) => [issue.kind, issue.path],
    );
}

describe("ADD_OPERATION", () => {
    // Proves `left` is required while `right` may be left to its default.
    test("requires left and defaults right", () => {
        expect(checkAddTask({ left: 1 })).toEqual([]);
        expect(checkAddTask({ right: 1 })).toEqual([["missing-argument", "/steps/0/inputs"]]);
    });

    // Proves both arguments accept numbers only.
    test("takes numbers", () => {
        expect(checkAddTask({ left: 1, right: "2" })).toEqual([
            ["type-mismatch", "/steps/0/inputs/right"],
        ]);
    });

    // Proves a step can bind to the sum as a number, but not as a narrower integer.
    test("returns value as any number", () => {
        expect(checkAddTask({ left: 1 }, { value: { type: "number" } })).toEqual([]);
        expect(checkAddTask({ left: 1 }, { value: { type: "integer" } })).toEqual([
            ["type-mismatch", "/steps/0/outputs/value"],
        ]);
    });

    // Proves an overflowing sum is a declared failure the daemon may report.
    test("declares numeric overflow", () => {
        expect(ADD_OPERATION.failureCodes).toContain("numeric_overflow");
    });
});
