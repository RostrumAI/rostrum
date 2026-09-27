/**
 * @fileoverview Tests `add`'s declaration. Publication and preparation
 * bind and check tasks against it, so a wrong default, argument schema,
 * output schema, or failure list would let a bad workflow publish.
 *
 * ADD_OPERATION declaration:
 * - requires left and defaults right to 0.
 * - takes numbers: a fraction passes and a numeric string fails `type`.
 * - returns only a numeric value: any number passes; a string value, an
 *   extra member, or a missing value fails.
 * - declares numeric overflow as its only failure code.
 */
import { describe, expect, test } from "bun:test";
import {
    createDeclaredSchemaCompiler,
    type JsonSchema,
} from "../declared-schemas/declared-schema-compiler";
import { ADD_OPERATION } from "./add";
import { toJsonSchema } from "./operation-catalog";

/** Compiles one of the declaration's schemas and returns the keywords a value fails. */
function getFailedKeywords(schema: JsonSchema, value: unknown): string[] {
    const compiled = createDeclaredSchemaCompiler().compile(schema);
    if (!compiled.ok) {
        throw new Error("Expected the declaration's schema to compile");
    }
    return compiled.check(value).map((issue) => issue.keyword);
}

describe("ADD_OPERATION declaration", () => {
    // Proves left must be bound while right falls back to a default of 0.
    test("requires left and defaults right to 0", () => {
        expect(Object.hasOwn(ADD_OPERATION.arguments.left, "default")).toBe(false);
        expect(ADD_OPERATION.arguments.right.default).toBe(0);
    });

    // Proves both arguments accept numbers and nothing else.
    test("takes numbers", () => {
        const left = toJsonSchema(ADD_OPERATION.arguments.left.schema);
        expect(getFailedKeywords(left, 1.5)).toEqual([]);
        expect(getFailedKeywords(left, "1")).toEqual(["type"]);
    });

    // Proves the output is exactly a numeric value member.
    test("returns only a numeric value", () => {
        const output = toJsonSchema(ADD_OPERATION.outputSchema);
        expect(getFailedKeywords(output, { value: -2.5 })).toEqual([]);
        expect(getFailedKeywords(output, { value: "3" })).toEqual(["type"]);
        expect(getFailedKeywords(output, { value: 3, sum: 3 })).toEqual(["additionalProperties"]);
        expect(getFailedKeywords(output, {})).toEqual(["required"]);
    });

    // Proves an overflowing sum is the only failure the operation declares.
    test("declares numeric overflow", () => {
        expect(ADD_OPERATION.failureCodes).toEqual(["numeric_overflow"]);
    });
});
