/**
 * @fileoverview Tests `KnownValueEvaluator`, which decides exactly whether
 * each value a finite producer allows passes a consumer schema. Its
 * verdicts must match the runtime validator, or the containment check
 * reports false mismatches or misses real ones.
 *
 * scalar keywords:
 * - type: integers count as numbers, 3.0 is an integer, type lists work.
 * - const and enum: compare JSON values regardless of object member order.
 * - numeric bounds: inclusive bounds pass at the boundary, exclusive fail.
 * - multipleOf: exact division; 0.3 is not a multiple of 0.1.
 * - string lengths: count code points, so one emoji has length 1.
 * - pattern: matches anywhere in the string unless anchored; a pattern
 *   the linear-time engine refuses, such as a lookahead, is unprovable.
 * - other types: keywords for another value type pass vacuously.
 *
 * arrays and objects:
 * - elements: prefixItems covers leading positions, items the rest,
 *   with each failure located at the schema that failed.
 * - array lengths, member counts: min/max items and properties.
 * - members: properties for named members, additionalProperties otherwise.
 * - required: only own members count, not inherited names like toString.
 * - __proto__: treated as an ordinary member name.
 *
 * combinators and references:
 * - allOf: every member must pass; reports the failing member's path.
 * - anyOf: one passing member suffices; all failing is a mismatch, and an
 *   undecidable member makes the result unprovable instead.
 * - $ref: local references are followed; external ones are unprovable.
 * - boolean schemas and unknown keywords: true passes, false is a
 *   mismatch, an incomparable keyword such as if is unprovable.
 * - incomparable keyword wins over order: patternProperties makes the
 *   result unprovable even when additionalProperties comes first.
 * - annotations: title, description, format, and default are ignored.
 */
import { describe, expect, test } from "bun:test";
import type { JsonSchema } from "./declared-schema-compiler";
import { KnownValueEvaluator } from "./known-value-evaluation";
import { ReferenceResolver } from "./schema-references";

/** Evaluates a value against a consumer whose references resolve against the consumer itself. */
function evaluate(consumer: JsonSchema, value: unknown) {
    return new KnownValueEvaluator(new ReferenceResolver(consumer)).evaluate(consumer, value, "");
}

describe("scalar keywords", () => {
    // Proves `type` follows JSON Schema: integers are numbers, whole fractions are integers.
    test("type", () => {
        expect(evaluate({ type: "number" }, 3)).toBeUndefined();
        expect(evaluate({ type: "integer" }, 3.0)).toBeUndefined();
        expect(evaluate({ type: ["string", "null"] }, null)).toBeUndefined();
        expect(evaluate({ type: "integer" }, 3.5)).toEqual({
            kind: "mismatch",
            keyword: "type",
            path: "/type",
        });
    });

    // Proves `const` and `enum` compare JSON values regardless of member order.
    test("const and enum", () => {
        expect(evaluate({ const: { a: 1, b: 2 } }, { b: 2, a: 1 })).toBeUndefined();

        // A differing member value fails const and is located at the keyword.
        expect(evaluate({ const: { a: 1, b: 2 } }, { a: 1, b: 3 })).toEqual({
            kind: "mismatch",
            keyword: "const",
            path: "/const",
        });

        // Enum passes on any listed value and fails when none match.
        expect(evaluate({ enum: ["x", "y"] }, "y")).toBeUndefined();
        expect(evaluate({ enum: ["x", "y"] }, "z")?.keyword).toBe("enum");
    });

    // Proves numeric bounds, including exclusive ones at the boundary value.
    test("numeric bounds", () => {
        expect(evaluate({ minimum: 0 }, 0)).toBeUndefined();
        expect(evaluate({ exclusiveMinimum: 0 }, 0)?.keyword).toBe("exclusiveMinimum");
        expect(evaluate({ maximum: 10 }, 10)).toBeUndefined();
        expect(evaluate({ exclusiveMaximum: 10 }, 10)?.keyword).toBe("exclusiveMaximum");
    });

    // Proves multipleOf uses the runtime's exact-division rule, so float rounding fails.
    test("multipleOf", () => {
        expect(evaluate({ multipleOf: 2 }, 6)).toBeUndefined();
        expect(evaluate({ multipleOf: 2 }, 7)?.keyword).toBe("multipleOf");

        // 0.3 / 0.1 is 2.9999999999999996, which the runtime rejects.
        expect(evaluate({ multipleOf: 0.1 }, 0.3)?.keyword).toBe("multipleOf");
    });

    // Proves string lengths count code points, as JSON Schema does, not UTF-16 units.
    test("string lengths count code points", () => {
        expect(evaluate({ maxLength: 1 }, "😀")).toBeUndefined();
        expect(evaluate({ minLength: 2 }, "😀")?.keyword).toBe("minLength");
    });

    // Proves patterns match anywhere in the string and run on the linear-time engine.
    test("pattern", () => {
        expect(evaluate({ pattern: "^Hello" }, "Hello, Ada!")).toBeUndefined();
        expect(evaluate({ pattern: "b+" }, "abba")).toBeUndefined();
        expect(evaluate({ pattern: "^Hello" }, "hi")?.keyword).toBe("pattern");
    });

    // Proves a pattern the linear-time engine can't compile is unprovable rather than thrown.
    test("uncompilable pattern is unprovable", () => {
        // RE2 has no lookaround, so the runtime could never decide this keyword.
        const consumer = { pattern: "(?=a)" };
        const evaluator = new KnownValueEvaluator(new ReferenceResolver(consumer));
        expect(evaluator.evaluate(consumer, "a", "")).toEqual({
            kind: "unprovable",
            keyword: "pattern",
            path: "/pattern",
        });

        // A second value on the same evaluator reuses the remembered refusal.
        expect(evaluator.evaluate(consumer, "b", "")?.kind).toBe("unprovable");
    });

    // Proves keywords for another type don't apply to a value of this type.
    test("keywords for other types are vacuous", () => {
        expect(
            evaluate({ minimum: 5, minLength: 5, minItems: 5, required: ["a"] }, true),
        ).toBeUndefined();
    });
});

describe("arrays and objects", () => {
    // Proves prefix positions use prefixItems and later positions use items, each located.
    test("elements", () => {
        const consumer = { prefixItems: [{ type: "string" }], items: { type: "number" } };
        expect(evaluate(consumer, ["a", 1, 2])).toBeUndefined();
        expect(evaluate(consumer, [1])).toEqual({
            kind: "mismatch",
            keyword: "type",
            path: "/prefixItems/0/type",
        });
        expect(evaluate(consumer, ["a", "b"])?.path).toBe("/items/type");
    });

    // Proves array lengths are checked against minItems and maxItems.
    test("array lengths", () => {
        expect(evaluate({ minItems: 1, maxItems: 2 }, [1, 2])).toBeUndefined();
        expect(evaluate({ minItems: 1 }, [])?.keyword).toBe("minItems");
        expect(evaluate({ maxItems: 2 }, [1, 2, 3])?.keyword).toBe("maxItems");
    });

    // Proves named members use properties, and other members use additionalProperties.
    test("members", () => {
        const consumer = {
            properties: { name: { type: "string" } },
            additionalProperties: { type: "number" },
        };
        expect(evaluate(consumer, { name: "Ada", age: 36 })).toBeUndefined();
        expect(evaluate(consumer, { name: 1 })?.path).toBe("/properties/name/type");
        expect(evaluate(consumer, { name: "Ada", nick: "A" })?.path).toBe(
            "/additionalProperties/type",
        );
    });

    // Proves required members must be own members, so an inherited name doesn't count.
    test("required", () => {
        expect(evaluate({ required: ["a"] }, { a: null })).toBeUndefined();
        expect(evaluate({ required: ["toString"] }, {})?.keyword).toBe("required");
    });

    // Proves member counts are checked against minProperties and maxProperties.
    test("member counts", () => {
        expect(evaluate({ minProperties: 1 }, {})?.keyword).toBe("minProperties");
        expect(evaluate({ maxProperties: 1 }, { a: 1, b: 2 })?.keyword).toBe("maxProperties");
    });

    // Proves a prototype-sensitive member name is compared as an ordinary name.
    test("__proto__ is an ordinary member", () => {
        const value = JSON.parse('{"__proto__": 1}');
        const consumer = JSON.parse('{"properties": {"__proto__": {"type": "string"}}}');
        expect(evaluate(consumer, value)?.path).toBe("/properties/__proto__/type");
    });
});

describe("combinators and references", () => {
    // Proves allOf requires every member and reports the failing member's location.
    test("allOf", () => {
        const consumer = { allOf: [{ type: "number" }, { minimum: 1 }] };
        expect(evaluate(consumer, 2)).toBeUndefined();
        expect(evaluate(consumer, 0)?.path).toBe("/allOf/1/minimum");
    });

    // Proves anyOf passes when some member does and is a mismatch when all members fail.
    test("anyOf", () => {
        const consumer = { anyOf: [{ type: "string" }, { type: "number" }] };
        expect(evaluate(consumer, 1)).toBeUndefined();
        expect(evaluate(consumer, true)).toEqual({
            kind: "mismatch",
            keyword: "anyOf",
            path: "/anyOf",
        });
    });

    // Proves an anyOf with an undecidable member is unprovable, not a mismatch.
    test("anyOf with an incomparable member is unprovable", () => {
        const consumer = { anyOf: [{ type: "string" }, { not: { type: "null" } }] };
        expect(evaluate(consumer, 1)).toEqual({
            kind: "unprovable",
            keyword: "not",
            path: "/anyOf/1/not",
        });
    });

    // Proves local references are followed and refused ones are unprovable.
    test("$ref", () => {
        const consumer = { $defs: { count: { type: "integer" } }, $ref: "#/$defs/count" };
        expect(evaluate(consumer, 1)).toBeUndefined();
        expect(evaluate(consumer, 1.5)?.keyword).toBe("type");
        expect(evaluate({ $ref: "other.json" }, 1)).toEqual({
            kind: "unprovable",
            keyword: "$ref",
            path: "/$ref",
        });
    });

    // Proves boolean schemas and incomparable keywords.
    test("boolean schemas and unknown keywords", () => {
        expect(evaluate(true, "anything")).toBeUndefined();
        expect(evaluate(false, null)).toEqual({ kind: "mismatch", keyword: "false", path: "" });
        expect(evaluate({ if: { type: "string" } }, "a")).toEqual({
            kind: "unprovable",
            keyword: "if",
            path: "/if",
        });
    });

    // Proves an incomparable keyword decides before an order-dependent mismatch.
    test("an incomparable keyword wins over keyword order", () => {
        // additionalProperties alone would reject `ab`, but patternProperties might accept it.
        const consumer = {
            additionalProperties: { type: "number" },
            patternProperties: { "^a": { type: "string" } },
        };
        expect(evaluate(consumer, { ab: "x" })).toEqual({
            kind: "unprovable",
            keyword: "patternProperties",
            path: "/patternProperties",
        });
    });

    // Proves annotation keywords never affect the outcome.
    test("annotations are ignored", () => {
        expect(
            evaluate({ title: "Count", description: "d", format: "email", default: 1 }, 5),
        ).toBeUndefined();
    });
});
