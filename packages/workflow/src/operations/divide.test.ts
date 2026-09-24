import { describe, expect, test } from "bun:test";
import { checkStaticCompatibility } from "../compatibility/static-compatibility-check";
import { createDeclaredSchemaCompiler } from "../declared-schemas/declared-schema-compiler";
import { buildDocument, resultStep, taskStep } from "../testing/documents";
import { DIVIDE_OPERATION } from "./divide";
import type { OperationCatalog } from "./operation-catalog";

/** A catalog holding only `divide`, so each case exercises its declaration alone. */
const CATALOG: OperationCatalog = new Map([[DIVIDE_OPERATION.name, DIVIDE_OPERATION]]);

/** Checks a `divide` task bound to `inputs` and returns the issue kinds and paths. */
function checkDivideTask(inputs: Record<string, unknown>, outputs?: Record<string, unknown>) {
    const end = resultStep();
    const task = taskStep({ config: { operation: "divide" }, inputs, successors: [end.id] });
    if (outputs) {
        task.outputs = outputs;
    }
    const document = buildDocument({ steps: [task, end], firstNode: task.id });
    return checkStaticCompatibility(document, CATALOG, createDeclaredSchemaCompiler()).map(
        (issue) => [issue.kind, issue.path],
    );
}

describe("DIVIDE_OPERATION", () => {
    // Proves both the dividend and the divisor must be bound, since neither has a default.
    test("requires both arguments", () => {
        expect(checkDivideTask({ dividend: 1, divisor: 2 })).toEqual([]);
        expect(checkDivideTask({ dividend: 1 })).toEqual([["missing-argument", "/steps/0/inputs"]]);
    });

    // Proves a zero divisor passes publication, because it's a runtime failure, not a type error.
    test("accepts a zero divisor statically", () => {
        expect(checkDivideTask({ dividend: 1, divisor: 0 })).toEqual([]);
    });

    // Proves a quotient can't be declared as an integer, since division yields fractions.
    test("returns value as any number", () => {
        expect(
            checkDivideTask({ dividend: 1, divisor: 2 }, { value: { type: "integer" } }),
        ).toEqual([["type-mismatch", "/steps/0/outputs/value"]]);
    });

    // Proves the runtime failures of division are declared for the daemon to report.
    test("declares division by zero and numeric overflow", () => {
        expect([...DIVIDE_OPERATION.failureCodes].sort()).toEqual([
            "division_by_zero",
            "numeric_overflow",
        ]);
    });
});
