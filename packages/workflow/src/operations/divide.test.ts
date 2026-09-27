/**
 * @fileoverview Tests `divide`'s declaration. Publication and preparation
 * bind and check tasks against it, so a wrong argument schema, output
 * schema, or failure list would let a bad workflow publish.
 *
 * DIVIDE_OPERATION declaration:
 * - requires both arguments: neither has a default.
 * - takes any number, including a zero divisor, which fails at run time
 *   rather than at binding; a numeric string fails `type`.
 * - returns only a numeric value: a null value or an extra member fails.
 * - declares `division_by_zero` and `numeric_overflow`.
 *
 * DIVIDE_OPERATION in the static check (a catalog holding only `divide`):
 * - an unbound divisor is a missing argument at the task's inputs.
 * - a step can't declare the quotient as an integer.
 */
import { describe, expect, test } from "bun:test";
import { checkStaticCompatibility } from "../compatibility/static-compatibility-check";
import {
    createDeclaredSchemaCompiler,
    type JsonSchema,
} from "../declared-schemas/declared-schema-compiler";
import { buildDocument, resultStep, taskStep } from "../testing/documents";
import { DIVIDE_OPERATION } from "./divide";
import { type OperationCatalog, toJsonSchema } from "./operation-catalog";

/** Compiles one of the declaration's schemas and returns the keywords a value fails. */
function getFailedKeywords(schema: JsonSchema, value: unknown): string[] {
    const compiled = createDeclaredSchemaCompiler().compile(schema);
    if (!compiled.ok) {
        throw new Error("Expected the declaration's schema to compile");
    }
    return compiled.check(value).map((issue) => issue.keyword);
}

describe("DIVIDE_OPERATION declaration", () => {
    // Proves neither argument has a default, so both must be bound.
    test("requires both arguments", () => {
        expect(Object.hasOwn(DIVIDE_OPERATION.arguments.dividend, "default")).toBe(false);
        expect(Object.hasOwn(DIVIDE_OPERATION.arguments.divisor, "default")).toBe(false);
    });

    // Proves the divisor schema admits zero, which is a run-time failure, not a binding error.
    test("takes any number, including a zero divisor", () => {
        const divisor = toJsonSchema(DIVIDE_OPERATION.arguments.divisor.schema);
        expect(getFailedKeywords(divisor, 0)).toEqual([]);
        expect(getFailedKeywords(divisor, "2")).toEqual(["type"]);
    });

    // Proves the output is exactly a numeric value member.
    test("returns only a numeric value", () => {
        const output = toJsonSchema(DIVIDE_OPERATION.outputSchema);
        expect(getFailedKeywords(output, { value: 0.5 })).toEqual([]);
        expect(getFailedKeywords(output, { value: null })).toEqual(["type"]);
        expect(getFailedKeywords(output, { value: 1, remainder: 0 })).toEqual([
            "additionalProperties",
        ]);
    });

    // Proves division by zero and overflow are the declared failures.
    test("declares division by zero and overflow", () => {
        expect([...DIVIDE_OPERATION.failureCodes].sort()).toEqual([
            "division_by_zero",
            "numeric_overflow",
        ]);
    });
});

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

describe("DIVIDE_OPERATION in the static check", () => {
    // Proves a missing divisor is located at the task's inputs.
    test("requires both arguments", () => {
        expect(checkDivideTask({ dividend: 1, divisor: 2 })).toEqual([]);
        expect(checkDivideTask({ dividend: 1 })).toEqual([["missing-argument", "/steps/0/inputs"]]);
    });

    // Proves a quotient can't be declared as an integer, since division yields fractions.
    test("returns value as any number", () => {
        expect(
            checkDivideTask({ dividend: 1, divisor: 2 }, { value: { type: "integer" } }),
        ).toEqual([["type-mismatch", "/steps/0/outputs/value"]]);
    });
});
