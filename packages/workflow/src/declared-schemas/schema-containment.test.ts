import { describe, expect, test } from "bun:test";
import { OPERATION_CATALOG, toJsonSchema } from "../operations/operation-catalog";
import type { JsonSchema } from "./declared-schema-compiler";
import { checkSchemaContainment } from "./schema-containment";

/** Returns just the outcome kind, for cases where the location doesn't matter. */
function kindOf(producer: JsonSchema, consumer: JsonSchema): string {
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
        expect(kindOf({ type: "number", minimum: 1 }, { type: "number", minimum: 0 })).toBe(
            "contained",
        );
        expect(kindOf({ type: "integer" }, { type: "number" })).toBe("contained");
        expect(kindOf({ type: "number" }, { type: "integer" })).toBe("mismatch");
    });

    // Proves exclusive bounds compare correctly at the boundary value.
    test("exclusive bounds at the boundary", () => {
        // Values > 0 fit > 0 and >= 0; values >= 0 don't fit > 0.
        expect(kindOf({ exclusiveMinimum: 0 }, { exclusiveMinimum: 0 })).toBe("contained");
        expect(kindOf({ exclusiveMinimum: 0 }, { minimum: 0 })).toBe("contained");
        expect(kindOf({ minimum: 0 }, { exclusiveMinimum: 0 })).toBe("mismatch");

        // An integer above 0.5 is at least 1, so it fits a minimum of 1.
        expect(kindOf({ type: "integer", exclusiveMinimum: 0.5 }, { minimum: 1 })).toBe(
            "contained",
        );
        expect(kindOf({ maximum: 10 }, { exclusiveMaximum: 10 })).toBe("mismatch");
    });

    // Proves multipleOf holds when a bounded integer producer's step is a multiple of the consumer's.
    test("multipleOf is proven only for exact integer division", () => {
        // Bounded integers divide exactly, so step 4 fits step 2 and integers fit step 1.
        const bounded = { type: "integer", minimum: -1000, maximum: 1000 };
        expect(kindOf({ ...bounded, multipleOf: 4 }, { multipleOf: 2 })).toBe("contained");
        expect(kindOf(bounded, { multipleOf: 1 })).toBe("contained");
        expect(kindOf({ ...bounded, multipleOf: 2 }, { multipleOf: 4 })).toBe("unprovable");

        // Fractions always include a value that isn't a multiple.
        expect(kindOf({ type: "number" }, { multipleOf: 1 })).toBe("mismatch");
    });

    // Proves the rounding cases the runtime rejects are never reported as contained.
    test("multipleOf never passes a pair the runtime check rejects", () => {
        // 0.3 / 0.1 isn't exactly 3 in binary floating point, so the runtime rejects 0.3.
        expect(kindOf({ type: "number", multipleOf: 0.3 }, { multipleOf: 0.1 })).toBe("mismatch");
        expect(kindOf({ const: 0.3 }, { multipleOf: 0.1 })).toBe("mismatch");
        expect(kindOf({ type: "integer" }, { multipleOf: 1.0000000001 })).toBe("unprovable");

        // 1e21 is an integer, but its quotient prints in exponent form and fails the runtime check.
        expect(kindOf({ type: "integer" }, { multipleOf: 1 })).toBe("unprovable");
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
            kindOf({ type: "string", pattern: "^a+$" }, { type: "string", pattern: "^a+$" }),
        ).toBe("contained");
    });

    // Proves ignoring a producer keyword only widens it, so a plain consumer still fits.
    test("a producer using not against a plain consumer fits", () => {
        expect(kindOf({ type: "string", not: { const: "" } }, { type: "string" })).toBe(
            "contained",
        );
    });

    // Proves an incomparable keyword where it can never apply doesn't block the binding.
    test("a keyword that can't apply to the producer's type is vacuous", () => {
        expect(kindOf({ type: "string" }, { minimum: 0 })).toBe("contained");
        expect(kindOf({ type: "number" }, { properties: { a: { not: {} } } })).toBe("contained");
    });
});

describe("finite producers", () => {
    // Proves an enum producer is checked value by value, so every member must fit.
    test("each enum member must satisfy the consumer", () => {
        expect(kindOf({ enum: [1, 2, 3] }, { type: "integer", minimum: 1 })).toBe("contained");
        expect(checkSchemaContainment({ enum: [1, 2, 3] }, { maximum: 2 })).toEqual({
            kind: "mismatch",
            keyword: "maximum",
            path: "/maximum",
        });
        expect(kindOf({ const: "a" }, { enum: ["a", "b"] })).toBe("contained");
    });

    // Proves an infinite producer never fits a consumer enumeration.
    test("an unbounded producer doesn't fit an enum", () => {
        expect(kindOf({ type: "string" }, { enum: ["a", "b"] })).toBe("mismatch");
        expect(kindOf({ type: "boolean" }, { enum: [true, false] })).toBe("contained");
    });

    // Proves producers with few values are enumerated instead of being reported as mismatches.
    test("short integer ranges and the empty string are finite", () => {
        expect(kindOf({ type: "integer", minimum: 1, maximum: 2 }, { enum: [1, 2] })).toBe(
            "contained",
        );
        expect(kindOf({ type: "integer", minimum: 1, maximum: 3 }, { enum: [1, 2] })).toBe(
            "mismatch",
        );
        expect(kindOf({ type: "string", maxLength: 0 }, { const: "" })).toBe("contained");
    });

    // Proves a mismatch that ignored producer constraints might explain is only unprovable.
    test("a mismatch against a producer with uncompared constraints is unprovable", () => {
        // `not` could exclude the failing values, so the checker can't claim they exist.
        expect(kindOf({ type: "number", not: { maximum: 0 } }, { exclusiveMinimum: 0 })).toBe(
            "unprovable",
        );
        // A pattern narrows strings but never turns one into a number.
        expect(kindOf({ type: "string", pattern: "^1$" }, { type: "number" })).toBe("mismatch");
        expect(kindOf({ type: "string", pattern: "^a$" }, { enum: ["a"] })).toBe("unprovable");
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
            kindOf(producer, {
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
            kindOf(
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
        expect(kindOf(producer, { properties: { constructor: { type: "string" } } })).toBe(
            "contained",
        );
        expect(
            checkSchemaContainment(producer, { properties: { constructor: { type: "number" } } }),
        ).toEqual({ kind: "mismatch", keyword: "type", path: "/properties/constructor/type" });
    });

    // Proves element schemas and length bounds are compared, including tuple positions.
    test("arrays compare elements, tuples, and lengths", () => {
        expect(
            kindOf(
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
            kindOf(
                { type: "array", prefixItems: [{ type: "string" }], items: false },
                { type: "array", prefixItems: [{ type: "string" }], maxItems: 1 },
            ),
        ).toBe("contained");
    });
});

describe("combinators and references", () => {
    // Proves anyOf on both sides: each producer branch must fit some consumer branch.
    test("anyOf producers and consumers", () => {
        const numberOrString = { anyOf: [{ type: "number" }, { type: "string" }] };
        expect(kindOf(numberOrString, numberOrString)).toBe("contained");
        expect(kindOf({ type: "integer" }, numberOrString)).toBe("contained");
        expect(checkSchemaContainment(numberOrString, { type: "number" })).toEqual({
            kind: "mismatch",
            keyword: "type",
            path: "/type",
        });

        // A multi-type producer is split by type, so each type can fit a different member.
        expect(kindOf({ type: ["string", "number"] }, numberOrString)).toBe("contained");
        expect(
            checkSchemaContainment({ type: "number" }, { anyOf: [{ minimum: 0 }, { maximum: 0 }] }),
        ).toEqual({ kind: "unprovable", keyword: "anyOf", path: "/anyOf" });

        // oneOf in a producer is read as anyOf, which only widens it.
        expect(
            kindOf({ oneOf: [{ type: "number" }, { type: "integer" }] }, { type: "number" }),
        ).toBe("contained");
    });

    // Proves allOf conjunctions combine on the producer side and all apply on the consumer side.
    test("allOf on both sides", () => {
        expect(kindOf({ allOf: [{ type: "number" }, { minimum: 0 }] }, { minimum: 0 })).toBe(
            "contained",
        );
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
        expect(kindOf(positive, { type: "number", minimum: 0 })).toBe("contained");
        expect(kindOf({ type: "integer", minimum: 1 }, positive)).toBe("contained");
        expect(kindOf({ type: "number" }, positive)).toBe("mismatch");
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
        expect(kindOf(tree, { type: "object" })).toBe("contained");
        expect(kindOf(tree, { properties: { child: { type: "object" } } })).toBe("mismatch");
    });

    // Proves a producer that splits into too many alternatives is unprovable, not expanded forever.
    test("producer expansion past the limit is unprovable", () => {
        const pair = { anyOf: [{ type: "number" }, { type: "string" }] };
        const wide = { allOf: [pair, pair, pair, pair, pair, pair, pair] };
        expect(checkSchemaContainment(wide, true).kind).toBe("unprovable");
    });
});

describe("boolean schemas", () => {
    // Proves `true` and `false` behave as the everything and nothing schemas.
    test("true accepts everything and false accepts nothing", () => {
        expect(kindOf({ type: "string" }, true)).toBe("contained");
        expect(kindOf(false, { type: "string" })).toBe("contained");
        expect(kindOf(true, { type: "string" })).toBe("mismatch");
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
