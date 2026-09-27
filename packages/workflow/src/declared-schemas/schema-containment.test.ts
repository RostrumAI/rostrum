/**
 * @fileoverview Tests `checkSchemaContainment`, which decides whether every
 * value a producer schema allows is also allowed by a consumer schema. Static
 * binding checks rely on it never reporting `contained` for a pair the runtime
 * validator could reject.
 *
 * - numbers: an unbounded number fails a minimum; tighter bounds and integer fit
 *   looser ones; exclusive bounds compare at the boundary; `multipleOf` is
 *   contained only for exact integer division and never for float-rounding or
 *   unbounded-integer cases the runtime rejects.
 * - keywords the checker can't compare: a consumer `not` is unprovable and
 *   named; patterns match only by identity; an ignored producer keyword only
 *   widens it; a keyword that can't apply to the producer's type is vacuous.
 * - finite producers: enum and short integer ranges are checked value by value;
 *   an unbounded producer fails a consumer enum; a mismatch becomes unprovable
 *   when an uncompared producer constraint could exclude the failing values.
 * - false mismatches the checker must avoid: enumerated candidates the
 *   producer's own bounds or step exclude aren't counterexamples; a nested
 *   `type` failure inside a consumer `anyOf` member is unprovable, not a
 *   mismatch; a wide integer range against an `enum` is unprovable.
 * - objects and arrays: members compare by name, including prototype names like
 *   `constructor`; unrequired members fail a consumer `required`; an open
 *   producer fails a closed consumer; elements, tuples, and lengths compare;
 *   an unbounded array or object fails each consumer length or count bound.
 * - combinators and references: `anyOf` on both sides, with multi-type producers
 *   split by type; producer `oneOf` read as `anyOf`; `allOf` on both sides; local
 *   `$ref` inlined on both sides, resolved against each side's document root when
 *   one is passed; a recursive `$ref` is unprovable as consumer and `true` as
 *   producer; expansion past the limit is unprovable, also when nested.
 * - boolean schemas: `true` and `false` act as the everything and nothing schemas.
 * - the operation catalog: every catalog schema is contained in itself.
 */
import { describe, expect, test } from "bun:test";
import { OPERATION_CATALOG, toJsonSchema } from "../operations/operation-catalog";
import type { JsonSchema } from "./declared-schema-compiler";
import { checkSchemaContainment } from "./schema-containment";
import type { ContainmentResult } from "./schema-keywords";

/** Returns just the outcome kind, for cases where the location doesn't matter. */
function getContainmentKind(producer: JsonSchema, consumer: JsonSchema): string {
    return checkSchemaContainment(producer, consumer).kind;
}

describe("numbers", () => {
    // Proves overlap isn't enough: a producer that allows -1 doesn't fit a minimum of 0.
    test("an unbounded number doesn't fit a minimum", () => {
        expect(checkSchemaContainment({ type: "number" }, { type: "number", minimum: 0 })).toEqual({
            kind: "mismatch",
            keyword: "minimum",
            path: "/minimum",
        });
    });

    // Proves a tighter producer bound is contained in a looser consumer bound.
    test("minimum 1 fits minimum 0, and integer fits number", () => {
        expect(
            getContainmentKind({ type: "number", minimum: 1 }, { type: "number", minimum: 0 }),
        ).toBe("contained");
        expect(getContainmentKind({ type: "integer" }, { type: "number" })).toBe("contained");
        expect(getContainmentKind({ type: "number" }, { type: "integer" })).toBe("mismatch");
    });

    // Proves exclusive bounds compare correctly at the boundary value.
    test("exclusive bounds at the boundary", () => {
        // Values > 0 fit > 0 and >= 0; values >= 0 don't fit > 0.
        expect(getContainmentKind({ exclusiveMinimum: 0 }, { exclusiveMinimum: 0 })).toBe(
            "contained",
        );
        expect(getContainmentKind({ exclusiveMinimum: 0 }, { minimum: 0 })).toBe("contained");
        expect(getContainmentKind({ minimum: 0 }, { exclusiveMinimum: 0 })).toBe("mismatch");

        // An integer above 0.5 is at least 1, so it fits a minimum of 1.
        expect(getContainmentKind({ type: "integer", exclusiveMinimum: 0.5 }, { minimum: 1 })).toBe(
            "contained",
        );
        expect(getContainmentKind({ maximum: 10 }, { exclusiveMaximum: 10 })).toBe("mismatch");
    });

    // Proves multipleOf holds when a bounded integer producer's step is a multiple of the consumer's.
    test("multipleOf is proven only for exact integer division", () => {
        // Bounded integers divide exactly, so step 4 fits step 2 and integers fit step 1.
        const bounded = { type: "integer", minimum: -1000, maximum: 1000 };
        expect(getContainmentKind({ ...bounded, multipleOf: 4 }, { multipleOf: 2 })).toBe(
            "contained",
        );
        expect(getContainmentKind(bounded, { multipleOf: 1 })).toBe("contained");
        expect(getContainmentKind({ ...bounded, multipleOf: 2 }, { multipleOf: 4 })).toBe(
            "unprovable",
        );

        // Fractions always include a value that isn't a multiple.
        expect(getContainmentKind({ type: "number" }, { multipleOf: 1 })).toBe("mismatch");
    });

    // Proves the rounding cases the runtime rejects are never reported as contained.
    test("multipleOf never passes a pair the runtime check rejects", () => {
        // 0.3 / 0.1 isn't exactly 3 in binary floating point, so the runtime rejects 0.3.
        // A stepped fractional producer is only unprovable: the checker doesn't search its steps.
        expect(getContainmentKind({ type: "number", multipleOf: 0.3 }, { multipleOf: 0.1 })).toBe(
            "unprovable",
        );
        expect(getContainmentKind({ const: 0.3 }, { multipleOf: 0.1 })).toBe("mismatch");
        expect(getContainmentKind({ type: "integer" }, { multipleOf: 1.0000000001 })).toBe(
            "unprovable",
        );

        // 1e21 is an integer, but its quotient prints in exponent form and fails the runtime check.
        expect(getContainmentKind({ type: "integer" }, { multipleOf: 1 })).toBe("unprovable");
    });
});

describe("keywords the checker can't compare", () => {
    // Proves a consumer keyword outside the comparable set blocks the binding and is named.
    test("a consumer using not is unprovable", () => {
        expect(checkSchemaContainment({ type: "string" }, { not: { type: "number" } })).toEqual({
            kind: "unprovable",
            keyword: "not",
            path: "/not",
        });
    });

    // Proves patterns are compared only by identity.
    test("a different pattern is unprovable, an identical one fits", () => {
        expect(
            checkSchemaContainment(
                { type: "string", pattern: "^a+$" },
                { type: "string", pattern: "^a*$" },
            ),
        ).toEqual({ kind: "unprovable", keyword: "pattern", path: "/pattern" });
        expect(
            getContainmentKind(
                { type: "string", pattern: "^a+$" },
                { type: "string", pattern: "^a+$" },
            ),
        ).toBe("contained");
    });

    // Proves ignoring a producer keyword only widens it, so a plain consumer still fits.
    test("a producer using not against a plain consumer fits", () => {
        expect(getContainmentKind({ type: "string", not: { const: "" } }, { type: "string" })).toBe(
            "contained",
        );
    });

    // Proves an incomparable keyword where it can never apply doesn't block the binding.
    test("a keyword that can't apply to the producer's type is vacuous", () => {
        expect(getContainmentKind({ type: "string" }, { minimum: 0 })).toBe("contained");
        expect(getContainmentKind({ type: "number" }, { properties: { a: { not: {} } } })).toBe(
            "contained",
        );
    });
});

describe("finite producers", () => {
    // Proves an enum producer is checked value by value, so every member must fit.
    test("each enum member must satisfy the consumer", () => {
        expect(getContainmentKind({ enum: [1, 2, 3] }, { type: "integer", minimum: 1 })).toBe(
            "contained",
        );
        expect(checkSchemaContainment({ enum: [1, 2, 3] }, { maximum: 2 })).toEqual({
            kind: "mismatch",
            keyword: "maximum",
            path: "/maximum",
        });
        expect(getContainmentKind({ const: "a" }, { enum: ["a", "b"] })).toBe("contained");
    });

    // Proves an infinite producer never fits a consumer enumeration.
    test("an unbounded producer doesn't fit an enum", () => {
        expect(getContainmentKind({ type: "string" }, { enum: ["a", "b"] })).toBe("mismatch");
        expect(getContainmentKind({ type: "boolean" }, { enum: [true, false] })).toBe("contained");
    });

    // Proves producers with few values are enumerated instead of being reported as mismatches.
    test("short integer ranges and the empty string are finite", () => {
        expect(
            getContainmentKind({ type: "integer", minimum: 1, maximum: 2 }, { enum: [1, 2] }),
        ).toBe("contained");
        expect(
            getContainmentKind({ type: "integer", minimum: 1, maximum: 3 }, { enum: [1, 2] }),
        ).toBe("mismatch");
        expect(getContainmentKind({ type: "string", maxLength: 0 }, { const: "" })).toBe(
            "contained",
        );
    });

    // Proves a mismatch that ignored producer constraints might explain is only unprovable.
    test("a mismatch against a producer with uncompared constraints is unprovable", () => {
        // `not` could exclude the failing values, so the checker can't claim they exist.
        expect(
            getContainmentKind({ type: "number", not: { maximum: 0 } }, { exclusiveMinimum: 0 }),
        ).toBe("unprovable");
        // A pattern narrows strings but never turns one into a number.
        expect(getContainmentKind({ type: "string", pattern: "^1$" }, { type: "number" })).toBe(
            "mismatch",
        );
        expect(getContainmentKind({ type: "string", pattern: "^a$" }, { enum: ["a"] })).toBe(
            "unprovable",
        );
    });
});

describe("objects and arrays", () => {
    // Proves nested members are compared, and required members must be guaranteed.
    test("nested objects compare member by member", () => {
        const producer = {
            type: "object",
            properties: { total: { type: "integer" } },
            required: ["total"],
            additionalProperties: false,
        };
        expect(
            getContainmentKind(producer, {
                type: "object",
                properties: { total: { type: "number" } },
                required: ["total"],
                additionalProperties: false,
            }),
        ).toBe("contained");

        // A member the producer doesn't require can't satisfy a consumer requirement.
        expect(
            checkSchemaContainment({ ...producer, required: [] }, { required: ["total"] }),
        ).toEqual({ kind: "mismatch", keyword: "required", path: "/required/0" });

        // An open producer can supply members a closed consumer rejects.
        expect(
            getContainmentKind(
                { type: "object", properties: { total: { type: "number" } } },
                { type: "object", additionalProperties: false, properties: { total: {} } },
            ),
        ).toBe("mismatch");
    });

    // Proves author-chosen member names are read as names, never through the prototype.
    test("prototype-sensitive member names are compared as ordinary names", () => {
        const producer = {
            type: "object",
            properties: { constructor: { type: "string" } },
            required: ["constructor"],
            additionalProperties: false,
        };
        expect(
            getContainmentKind(producer, { properties: { constructor: { type: "string" } } }),
        ).toBe("contained");
        expect(
            checkSchemaContainment(producer, { properties: { constructor: { type: "number" } } }),
        ).toEqual({ kind: "mismatch", keyword: "type", path: "/properties/constructor/type" });
    });

    // Proves element schemas and length bounds are compared, including tuple positions.
    test("arrays compare elements, tuples, and lengths", () => {
        expect(
            getContainmentKind(
                { type: "array", items: { type: "integer" }, minItems: 2 },
                {
                    type: "array",
                    items: { type: "number" },
                    minItems: 1,
                },
            ),
        ).toBe("contained");
        expect(checkSchemaContainment({ type: "array" }, { items: { type: "number" } })).toEqual({
            kind: "mismatch",
            keyword: "type",
            path: "/items/type",
        });
        expect(
            getContainmentKind(
                { type: "array", prefixItems: [{ type: "string" }], items: false },
                { type: "array", prefixItems: [{ type: "string" }], maxItems: 1 },
            ),
        ).toBe("contained");
    });

    // Proves each length and member-count bound fails when the producer can fall outside it.
    test("length and count bounds that the producer can break", () => {
        const at = (keyword: string): ContainmentResult => ({
            kind: "mismatch",
            keyword,
            path: `/${keyword}`,
        });
        expect(checkSchemaContainment({ type: "array" }, { minItems: 1 })).toEqual(at("minItems"));
        expect(checkSchemaContainment({ type: "array" }, { maxItems: 3 })).toEqual(at("maxItems"));
        expect(checkSchemaContainment({ type: "object" }, { minProperties: 1 })).toEqual(
            at("minProperties"),
        );
        expect(checkSchemaContainment({ type: "object" }, { maxProperties: 2 })).toEqual(
            at("maxProperties"),
        );

        // Tighter producer bounds, or a closed object with few enough members, fit.
        expect(
            getContainmentKind(
                { type: "array", minItems: 1, maxItems: 3 },
                { minItems: 1, maxItems: 3 },
            ),
        ).toBe("contained");
        const pair = { properties: { a: true, b: true }, additionalProperties: false };
        expect(getContainmentKind({ type: "object", ...pair }, { maxProperties: 2 })).toBe(
            "contained",
        );
    });
});

describe("false mismatches the checker must avoid", () => {
    // Proves enumerated candidates the producer's own bounds or step exclude aren't counterexamples.
    test("finite values respect the producer's other keywords", () => {
        expect(getContainmentKind({ enum: [1, 5], minimum: 3 }, { minimum: 3 })).toBe("contained");
        expect(
            getContainmentKind(
                { type: "integer", minimum: 0, maximum: 6, multipleOf: 2 },
                { multipleOf: 2 },
            ),
        ).toBe("contained");
    });

    // Proves a nested member's type failure doesn't make an anyOf a definite mismatch.
    test("a nested type failure inside an anyOf member is not outright rejection", () => {
        const producer = {
            type: "object",
            properties: { a: { anyOf: [{ type: "number" }, { type: "string" }] } },
            required: ["a"],
            additionalProperties: false,
        };
        const consumer = {
            anyOf: [
                { type: "object", properties: { a: { type: "number" } }, required: ["a"] },
                { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
            ],
        };
        expect(getContainmentKind(producer, consumer)).toBe("unprovable");

        // A member rejecting the producer's own type is still a definite mismatch.
        expect(
            getContainmentKind(
                { type: "boolean" },
                { anyOf: [{ type: "string" }, { type: "number" }] },
            ),
        ).toBe("mismatch");
    });

    // Proves a wide but finite integer range against an enum is unprovable, not a mismatch.
    test("a wide integer range against an enum", () => {
        const allValues = Array.from({ length: 100 }, (_, index) => index);
        expect(
            getContainmentKind({ type: "integer", minimum: 0, maximum: 99 }, { enum: allValues }),
        ).toBe("unprovable");
    });
});

describe("combinators and references", () => {
    // Proves anyOf on both sides: each producer branch must fit some consumer branch.
    test("anyOf producers and consumers", () => {
        const numberOrString = { anyOf: [{ type: "number" }, { type: "string" }] };
        expect(getContainmentKind(numberOrString, numberOrString)).toBe("contained");
        expect(getContainmentKind({ type: "integer" }, numberOrString)).toBe("contained");
        expect(checkSchemaContainment(numberOrString, { type: "number" })).toEqual({
            kind: "mismatch",
            keyword: "type",
            path: "/type",
        });

        // A multi-type producer is split by type, so each type can fit a different member.
        expect(getContainmentKind({ type: ["string", "number"] }, numberOrString)).toBe(
            "contained",
        );
        expect(
            checkSchemaContainment({ type: "number" }, { anyOf: [{ minimum: 0 }, { maximum: 0 }] }),
        ).toEqual({ kind: "unprovable", keyword: "anyOf", path: "/anyOf" });

        // oneOf in a producer is read as anyOf, which only widens it.
        expect(
            getContainmentKind(
                { oneOf: [{ type: "number" }, { type: "integer" }] },
                { type: "number" },
            ),
        ).toBe("contained");
    });

    // Proves allOf conjunctions combine on the producer side and all apply on the consumer side.
    test("allOf on both sides", () => {
        expect(
            getContainmentKind({ allOf: [{ type: "number" }, { minimum: 0 }] }, { minimum: 0 }),
        ).toBe("contained");
        expect(
            checkSchemaContainment(
                { type: "number" },
                { allOf: [{ type: "number" }, { minimum: 0 }] },
            ),
        ).toEqual({ kind: "mismatch", keyword: "minimum", path: "/allOf/1/minimum" });
    });

    // Proves local references are inlined on both sides.
    test("local $ref resolves into $defs", () => {
        const positive = {
            $defs: { positive: { type: "number", minimum: 0 } },
            $ref: "#/$defs/positive",
        };
        expect(getContainmentKind(positive, { type: "number", minimum: 0 })).toBe("contained");
        expect(getContainmentKind({ type: "integer", minimum: 1 }, positive)).toBe("contained");
        expect(getContainmentKind({ type: "number" }, positive)).toBe("mismatch");
    });

    // Proves a subschema's `$ref` resolves against the document root passed for its side.
    test("subschema references resolve against their document roots", () => {
        // Each document defines `limit` differently, and the subschemas only refer to it.
        const producerRoot = { $defs: { limit: { type: "integer", minimum: 5 } } };
        const consumerRoot = { $defs: { limit: { type: "number", minimum: 0 } } };
        const reference = { $ref: "#/$defs/limit" };
        const roots = { producerRoot, consumerRoot };

        // Integers of at least 5 fit numbers of at least 0.
        expect(checkSchemaContainment(reference, reference, roots).kind).toBe("contained");

        // Swapping the roots compares numbers of at least 0 to integers of at least 5, which fails.
        const swapped = { producerRoot: consumerRoot, consumerRoot: producerRoot };
        expect(checkSchemaContainment(reference, reference, swapped)).toEqual({
            kind: "mismatch",
            keyword: "type",
            path: "/type",
        });

        // Without roots the subschemas are their own documents, so `limit` can't be resolved.
        expect(checkSchemaContainment(reference, reference)).toEqual({
            kind: "unprovable",
            keyword: "$ref",
            path: "/$ref",
        });
    });

    // Proves a recursive reference is unprovable as a consumer and read as `true` as a producer.
    test("recursive $ref", () => {
        const tree = {
            type: "object",
            properties: { child: { $ref: "#" } },
        };
        expect(
            checkSchemaContainment({ type: "object" }, { properties: { child: { $ref: "#" } } }),
        ).toEqual({
            kind: "unprovable",
            keyword: "$ref",
            path: "/properties/child/$ref",
        });
        expect(getContainmentKind(tree, { type: "object" })).toBe("contained");
        expect(getContainmentKind(tree, { properties: { child: { type: "object" } } })).toBe(
            "mismatch",
        );
    });

    // Proves a producer that splits into too many alternatives is unprovable, not expanded forever.
    test("producer expansion past the limit is unprovable", () => {
        const pair = { anyOf: [{ type: "number" }, { type: "string" }] };
        const wide = { allOf: [pair, pair, pair, pair, pair, pair, pair] };
        expect(checkSchemaContainment(wide, true).kind).toBe("unprovable");

        // The same width inside array items and object members is unprovable too, not thrown.
        const array = { type: "array", items: wide };
        const object = { type: "object", properties: { a: wide }, required: ["a"] };
        expect(checkSchemaContainment(array, { type: "array", items: true }).kind).toBe(
            "unprovable",
        );
        expect(
            checkSchemaContainment(object, { type: "object", properties: { a: true } }).kind,
        ).toBe("unprovable");
    });
});

describe("boolean schemas", () => {
    // Proves `true` and `false` behave as the everything and nothing schemas.
    test("true accepts everything and false accepts nothing", () => {
        expect(getContainmentKind({ type: "string" }, true)).toBe("contained");
        expect(getContainmentKind(false, { type: "string" })).toBe("contained");
        expect(getContainmentKind(true, { type: "string" })).toBe("mismatch");
        expect(checkSchemaContainment({ type: "string" }, false)).toEqual({
            kind: "mismatch",
            keyword: "false",
            path: "",
        });
    });
});

describe("the operation catalog", () => {
    // Proves every catalog schema uses only comparable keywords, by comparing it with itself.
    test("every catalog schema is comparable", () => {
        for (const operation of OPERATION_CATALOG.values()) {
            const schemas = [
                operation.configSchema,
                operation.outputSchema,
                ...Object.values(operation.arguments).map((argument) => argument.schema),
            ];
            for (const schema of schemas) {
                const json = toJsonSchema(schema);
                expect({
                    operation: operation.name,
                    result: checkSchemaContainment(json, json),
                }).toEqual({
                    operation: operation.name,
                    result: { kind: "contained" },
                });
            }
        }
    });
});
