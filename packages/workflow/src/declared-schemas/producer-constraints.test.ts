/**
 * @fileoverview Tests the per-keyword readings of a producer conjunction
 * and its comparisons against a consumer schema. Each reading must err
 * wide, so the containment check never passes a producer value the
 * consumer would reject.
 *
 * possible kinds and finite values:
 * - kinds: conjuncts intersect their types; an integer multipleOf rules
 *   out fractions and a fractional one doesn't.
 * - finite values: const and enum intersect and drop values the type
 *   excludes; null, booleans, a range under 64 integers, and the empty
 *   string are enumerated; unbounded, wider, or unsafe-integer ranges
 *   are not.
 *
 * type and enumeration:
 * - typeFits: every producer kind must be in the consumer's type.
 * - enumerationFits: an infinite producer never fits a const or enum; a
 *   finite one too large to enumerate is unprovable.
 *
 * numbers and strings:
 * - bounds: the producer's tightest bound must sit inside the consumer's;
 *   integer bounds round inward; an unbounded side fails.
 * - multipleOf: proven only for bounded integers with a dividing step,
 *   otherwise unprovable; a proper interval of fractions is a mismatch,
 *   and a stepped or single-point fractional producer is unprovable.
 * - non-numbers: numeric keywords pass vacuously.
 * - lengths: the producer's tightest length bounds are compared.
 * - pattern: only an identical producer pattern proves it.
 *
 * counts, arrays, and objects:
 * - count bounds default to 0 and infinity and take the tightest conjunct.
 * - a closed tuple caps maxItems at its prefix length.
 * - element schemas: prefixItems, then items, then anything.
 * - closed names intersect; patternProperties keeps an object open.
 * - declared names collect across conjuncts; unnamed members fall back to
 *   additionalProperties, or anything.
 *
 * uncompared constraints:
 * - a producer keyword outside the comparable set can explain any
 *   mismatch; a producer pattern only matters for string and value keywords.
 */
import { describe, expect, test } from "bun:test";
import {
    enumerationFits,
    getClosedMemberNames,
    getDeclaredMemberNames,
    getElementSchema,
    getFiniteValues,
    getLowerBound,
    getMaxItems,
    getMemberSchema,
    getPossibleKinds,
    getUnnamedMemberSchema,
    getUpperBound,
    hasUncomparedConstraints,
    numberFits,
    stringFits,
    typeFits,
} from "./producer-constraints";

describe("possible kinds", () => {
    // Proves conjuncts intersect their types, and no type allows every kind.
    test("intersects types across conjuncts", () => {
        expect(getPossibleKinds([]).size).toBe(7);
        expect([
            ...getPossibleKinds([{ type: "number" }, { type: ["integer", "string"] }]),
        ]).toEqual(["integer"]);
        expect(getPossibleKinds([{ type: "string" }, { type: "number" }]).size).toBe(0);
    });

    // Proves an integer step rules out fractions, while a fractional step doesn't.
    test("an integer multipleOf rules out fractions", () => {
        expect(getPossibleKinds([{ type: "number", multipleOf: 2 }]).has("fraction")).toBe(false);
        expect(getPossibleKinds([{ type: "number", multipleOf: 0.5 }]).has("fraction")).toBe(true);
    });
});

describe("finite values", () => {
    // Proves const and enum intersect across conjuncts, dropping values the type excludes.
    test("const and enum", () => {
        expect(getFiniteValues([{ enum: [1, 2, 3] }, { enum: [2, 3, 4] }])).toEqual([2, 3]);
        expect(getFiniteValues([{ const: "a" }])).toEqual(["a"]);
        expect(getFiniteValues([{ enum: [1, "a"] }, { type: "string" }])).toEqual(["a"]);
    });

    // Proves kinds with few values are enumerated: null, booleans, short ranges, empty strings.
    test("small kinds are enumerated", () => {
        expect(getFiniteValues([{ type: ["null", "boolean"] }])).toEqual([null, true, false]);
        expect(getFiniteValues([{ type: "integer", minimum: 1, exclusiveMaximum: 4 }])).toEqual([
            1, 2, 3,
        ]);
        expect(getFiniteValues([{ type: "string", maxLength: 0 }])).toEqual([""]);
    });

    // Proves an unbounded or too-wide producer isn't enumerated.
    test("infinite producers return undefined", () => {
        expect(getFiniteValues([{ type: "string" }])).toBeUndefined();
        expect(getFiniteValues([{ type: "integer", minimum: 0 }])).toBeUndefined();
        expect(getFiniteValues([{ type: "integer", minimum: 0, maximum: 64 }])).toBeUndefined();
        expect(getFiniteValues([{ type: "integer", minimum: 0, maximum: 63 }])).toHaveLength(64);

        // A range beyond the safe integers can't be counted through, so it isn't enumerated.
        expect(
            getFiniteValues([{ type: "integer", minimum: 2 ** 60, maximum: 2 ** 60 }]),
        ).toBeUndefined();
    });
});

describe("type and enumeration", () => {
    // Proves every kind the producer allows must be accepted by the consumer's type.
    test("typeFits", () => {
        expect(typeFits([{ type: "integer" }], { type: "number" }, "")).toBeUndefined();
        expect(typeFits([{ type: ["string", "null"] }], { type: "string" }, "/x")).toEqual({
            kind: "mismatch",
            keyword: "type",
            path: "/x/type",
        });
        expect(typeFits([{}], {}, "")).toBeUndefined();
    });

    // Proves an infinite producer never fits a consumer const or enum.
    test("enumerationFits", () => {
        expect(enumerationFits([{ type: "number" }], { enum: [1] }, "")).toEqual({
            kind: "mismatch",
            keyword: "enum",
            path: "/enum",
        });
        expect(enumerationFits([{}], { const: 1 }, "")?.keyword).toBe("const");
        expect(enumerationFits([{}], { type: "number" }, "")).toBeUndefined();
    });

    // Proves a finite producer too large to enumerate might still fit, so it's unprovable.
    test("enumerationFits for a wide finite producer", () => {
        const wideRange = [{ type: "integer", minimum: 0, maximum: 99 }];
        const shortStrings = [{ type: ["string", "null"], maxLength: 3 }];
        expect(enumerationFits(wideRange, { enum: [0] }, "")?.kind).toBe("unprovable");
        expect(enumerationFits(shortStrings, { enum: [""] }, "")?.kind).toBe("unprovable");
    });
});

describe("numbers", () => {
    // Proves the producer's tightest bound on each side must sit inside the consumer's.
    test("bounds", () => {
        const producer = [{ type: "number", minimum: 0 }, { maximum: 5 }, { minimum: 1 }];
        expect(numberFits(producer, { minimum: 1, maximum: 5 }, "")).toBeUndefined();
        expect(numberFits(producer, { minimum: 2 }, "")?.keyword).toBe("minimum");
        expect(numberFits(producer, { exclusiveMaximum: 5 }, "")?.keyword).toBe("exclusiveMaximum");
    });

    // Proves integers round exclusive and fractional bounds inward to whole numbers.
    test("integer bounds round inward", () => {
        const producer = [{ type: "integer", exclusiveMinimum: 0, maximum: 9.5 }];
        expect(numberFits(producer, { minimum: 1, maximum: 9 }, "")).toBeUndefined();
    });

    // Proves an unbounded producer side fails any consumer bound on that side.
    test("an unbounded side fails", () => {
        expect(numberFits([{ type: "number" }], { maximum: 100 }, "/n")).toEqual({
            kind: "mismatch",
            keyword: "maximum",
            path: "/n/maximum",
        });
    });

    // Proves multipleOf is proven only for bounded integers, and an unstepped fraction interval mismatches.
    test("multipleOf", () => {
        const bounded = { type: "integer", minimum: 0, maximum: 1000 };
        expect(numberFits([{ ...bounded, multipleOf: 6 }], { multipleOf: 3 }, "")).toBeUndefined();
        expect(numberFits([{ ...bounded, multipleOf: 3 }], { multipleOf: 6 }, "")?.kind).toBe(
            "unprovable",
        );
        expect(numberFits([{ type: "integer" }], { multipleOf: 1 }, "")?.kind).toBe("unprovable");
        expect(numberFits([{ type: "number" }], { multipleOf: 1 }, "")?.kind).toBe("mismatch");

        // A fractional step of its own, or a single point, might divide evenly.
        expect(
            numberFits([{ type: "number", multipleOf: 0.5 }], { multipleOf: 0.5 }, "")?.kind,
        ).toBe("unprovable");
        expect(
            numberFits([{ type: "number", minimum: 0, maximum: 0 }], { multipleOf: 3 }, "")?.kind,
        ).toBe("unprovable");
    });

    // Proves numeric keywords don't apply when the producer can't be a number.
    test("vacuous for non-numbers", () => {
        expect(numberFits([{ type: "string" }], { minimum: 0 }, "")).toBeUndefined();
    });
});

describe("strings", () => {
    // Proves length bounds compare the producer's tightest bounds.
    test("lengths", () => {
        const producer = [{ type: "string", minLength: 2, maxLength: 4 }];
        expect(stringFits(producer, { minLength: 1, maxLength: 5 }, "")).toBeUndefined();
        expect(stringFits(producer, { minLength: 3 }, "")?.keyword).toBe("minLength");
        expect(stringFits(producer, { maxLength: 3 }, "")?.keyword).toBe("maxLength");
    });

    // Proves only an identical producer pattern proves a consumer pattern.
    test("patterns compare by identity", () => {
        expect(stringFits([{ pattern: "^a" }], { pattern: "^a" }, "")).toBeUndefined();
        expect(stringFits([{ pattern: "^ab" }], { pattern: "^a" }, "/s")).toEqual({
            kind: "unprovable",
            keyword: "pattern",
            path: "/s/pattern",
        });
    });
});

describe("counts, arrays, and objects", () => {
    // Proves count bounds default to 0 and infinity and take the tightest conjunct.
    test("lower and upper bounds", () => {
        expect(getLowerBound([], "minItems")).toBe(0);
        expect(getUpperBound([], "maxItems")).toBe(Number.POSITIVE_INFINITY);
        expect(getLowerBound([{ minItems: 1 }, { minItems: 3 }], "minItems")).toBe(3);
        expect(getUpperBound([{ maxItems: 5 }, { maxItems: 2 }], "maxItems")).toBe(2);
    });

    // Proves a closed tuple limits the array length to its prefix.
    test("max items of a closed tuple", () => {
        expect(getMaxItems([{ prefixItems: [true, true], items: false }])).toBe(2);
        expect(getMaxItems([{ prefixItems: [true, true] }])).toBe(Number.POSITIVE_INFINITY);
    });

    // Proves each position takes its prefix schema, then items, then anything.
    test("element schemas", () => {
        const conjunct = { prefixItems: [{ type: "string" }], items: { type: "number" } };
        expect(getElementSchema(conjunct, 0)).toEqual({ type: "string" });
        expect(getElementSchema(conjunct, 5)).toEqual({ type: "number" });
        expect(getElementSchema({}, 0)).toBe(true);
    });

    // Proves closed conjuncts intersect their names, and patternProperties keeps an object open.
    test("closed member names", () => {
        const closed = { properties: { a: true, b: true }, additionalProperties: false };
        expect(getClosedMemberNames([{ properties: { a: true } }])).toBeUndefined();
        expect([
            ...(getClosedMemberNames([
                closed,
                { properties: { b: true }, additionalProperties: false },
            ]) ?? []),
        ]).toEqual(["b"]);
        expect(getClosedMemberNames([{ ...closed, patternProperties: {} }])).toBeUndefined();
    });

    // Proves declared names collect across conjuncts.
    test("declared member names", () => {
        expect([
            ...getDeclaredMemberNames([{ properties: { a: true } }, { properties: { b: true } }]),
        ]).toEqual(["a", "b"]);
    });

    // Proves an unnamed member falls back to additionalProperties, or anything.
    test("member schemas", () => {
        const conjunct = {
            properties: { a: { type: "string" } },
            additionalProperties: { type: "number" },
        };
        expect(getMemberSchema(conjunct, "a")).toEqual({ type: "string" });
        expect(getMemberSchema(conjunct, "z")).toEqual({ type: "number" });
        expect(getUnnamedMemberSchema({ ...conjunct, patternProperties: {} })).toBe(true);
        expect(getUnnamedMemberSchema({})).toBe(true);
    });
});

describe("uncompared constraints", () => {
    // Proves a producer keyword outside the comparable set can explain any mismatch away.
    test("an incomparable producer keyword", () => {
        expect(hasUncomparedConstraints([{ not: { const: 0 } }], "minimum")).toBe(true);
        expect(hasUncomparedConstraints([{ minimum: 0, title: "t" }], "minimum")).toBe(false);
    });

    // Proves a producer pattern only matters for keywords a pattern could narrow.
    test("a producer pattern", () => {
        expect(hasUncomparedConstraints([{ pattern: "^a$" }], "maxLength")).toBe(true);
        expect(hasUncomparedConstraints([{ pattern: "^a$" }], "type")).toBe(false);
    });
});
