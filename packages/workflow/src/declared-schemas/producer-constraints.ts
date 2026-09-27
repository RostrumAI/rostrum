import { isJsonSchema, type JsonSchema } from "./declared-schema-compiler";
import {
    ALL_KINDS,
    COMPARABLE_KEYWORDS,
    type Conjunction,
    type ContainmentFailure,
    getTypeKinds,
    getValueKind,
    IGNORED_KEYWORDS,
    isSameJson,
    readSchemaList,
    readSchemaRecord,
    readTypeList,
    type SchemaObject,
    type ValueKind,
} from "./schema-keywords";

/**
 * What one producer conjunction allows, read keyword by keyword, and the
 * per-keyword containment comparisons against a consumer schema.
 *
 * Every reading errs wide: a bound the producer doesn't state is read as
 * unbounded, and a producer keyword outside the comparable set is
 * ignored. A comparison therefore never passes a producer value the
 * consumer would reject, though it can refuse a pair that always fits.
 */

/**
 * The value kinds a producer conjunction can take: the intersection of
 * every conjunct's `type`. An integer `multipleOf` rules out fractions.
 */
export function getPossibleKinds(producer: Conjunction): Set<ValueKind> {
    let kinds = new Set<ValueKind>(ALL_KINDS);
    for (const conjunct of producer) {
        if (conjunct.type !== undefined) {
            const allowed = new Set(readTypeList(conjunct.type).flatMap(getTypeKinds));
            kinds = new Set([...kinds].filter((kind) => allowed.has(kind)));
        }
        if (typeof conjunct.multipleOf === "number" && Number.isInteger(conjunct.multipleOf)) {
            kinds.delete("fraction");
        }
    }
    return kinds;
}

/**
 * The exact values a producer conjunction allows, when a `const` or
 * `enum`, or a type with only one or two values, makes the set finite.
 * Returns undefined for an infinite producer.
 */
export function getFiniteValues(producer: Conjunction): unknown[] | undefined {
    let values: unknown[] | undefined;
    for (const conjunct of producer) {
        let allowed: unknown[] | undefined;
        if (Object.hasOwn(conjunct, "const")) {
            allowed = [conjunct.const];
        } else if (Array.isArray(conjunct.enum)) {
            allowed = conjunct.enum;
        }
        if (allowed) {
            values = values
                ? values.filter((value) => allowed.some((other) => isSameJson(value, other)))
                : [...allowed];
        }
    }

    // Other producer keywords narrow the set further, but ignoring them
    // only keeps extra values, which is the safe direction.
    const kinds = getPossibleKinds(producer);
    if (values) {
        return values.filter((value) => kinds.has(getValueKind(value)));
    }
    // Kinds with few values: null, booleans, a short integer range, and the empty string.
    const finite: unknown[] = [];
    for (const kind of kinds) {
        const members = getFiniteMembers(producer, kind);
        if (!members) {
            return undefined;
        }
        finite.push(...members);
    }
    return finite;
}

/** The most integers a bounded integer producer is enumerated into. */
const MAX_ENUMERATED_INTEGERS = 64;

/** Lists every value of one kind the producer allows, or undefined when there are too many. */
function getFiniteMembers(producer: Conjunction, kind: ValueKind): unknown[] | undefined {
    switch (kind) {
        case "null":
            return [null];
        case "boolean":
            return [true, false];
        case "integer": {
            const lower = getNumericBound(producer, "minimum", "exclusiveMinimum", true);
            const upper = getNumericBound(producer, "maximum", "exclusiveMaximum", true);
            // Past the safe-integer range `value++` stops changing the value, so the loop never ends.
            if (
                !lower ||
                !upper ||
                !Number.isSafeInteger(lower.value) ||
                !Number.isSafeInteger(upper.value) ||
                upper.value - lower.value >= MAX_ENUMERATED_INTEGERS
            ) {
                return undefined;
            }
            const integers: number[] = [];
            for (let value = lower.value; value <= upper.value; value++) {
                integers.push(value);
            }
            return integers;
        }
        case "string":
            return getUpperBound(producer, "maxLength") === 0 ? [""] : undefined;
        default:
            return undefined;
    }
}

/** Checks the consumer's `type` against the kinds the producer can take. */
export function typeFits(
    producer: Conjunction,
    consumer: SchemaObject,
    path: string,
): ContainmentFailure | undefined {
    if (consumer.type === undefined) {
        return undefined;
    }
    const accepted = new Set(readTypeList(consumer.type).flatMap(getTypeKinds));
    for (const kind of getPossibleKinds(producer)) {
        if (!accepted.has(kind)) {
            return { kind: "mismatch", keyword: "type", path: `${path}/type` };
        }
    }
    return undefined;
}

/**
 * Checks a consumer `const` or `enum` against a producer too large to
 * check value by value. A producer with infinitely many values can only
 * fit one by accident, so that is a mismatch; a finite one, such as a
 * wide integer range, might fit, so that is unprovable.
 */
export function enumerationFits(
    producer: Conjunction,
    consumer: SchemaObject,
    path: string,
): ContainmentFailure | undefined {
    for (const keyword of ["const", "enum"] as const) {
        if (Object.hasOwn(consumer, keyword)) {
            return {
                kind: hasInfinitelyManyValues(producer) ? "mismatch" : "unprovable",
                keyword,
                path: `${path}/${keyword}`,
            };
        }
    }
    return undefined;
}

/**
 * True when the producer allows infinitely many values: some kind it can
 * take isn't null, boolean, an integer bounded on both sides, or a string
 * with a maximum length.
 */
function hasInfinitelyManyValues(producer: Conjunction): boolean {
    for (const kind of getPossibleKinds(producer)) {
        switch (kind) {
            case "null":
            case "boolean":
                continue;
            case "integer":
                if (
                    getNumericBound(producer, "minimum", "exclusiveMinimum", true) &&
                    getNumericBound(producer, "maximum", "exclusiveMaximum", true)
                ) {
                    continue;
                }
                return true;
            case "string":
                if (Number.isFinite(getUpperBound(producer, "maxLength"))) {
                    continue;
                }
                return true;
            default:
                return true;
        }
    }
    return false;
}

/** Checks numeric keywords, which apply only when the producer can be a number. */
export function numberFits(
    producer: Conjunction,
    consumer: SchemaObject,
    path: string,
): ContainmentFailure | undefined {
    const kinds = getPossibleKinds(producer);
    if (!kinds.has("integer") && !kinds.has("fraction")) {
        return undefined;
    }
    const integral = !kinds.has("fraction");

    // Bounds: the producer's tightest bound on each side must sit inside the consumer's.
    const lower = getNumericBound(producer, "minimum", "exclusiveMinimum", integral);
    const upper = getNumericBound(producer, "maximum", "exclusiveMaximum", integral);
    const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf } = consumer;
    let failed: string | undefined;
    if (typeof minimum === "number" && !(lower && lower.value >= minimum)) {
        failed = "minimum";
    } else if (
        typeof exclusiveMinimum === "number" &&
        !(lower && exceeds(lower, exclusiveMinimum, 1))
    ) {
        failed = "exclusiveMinimum";
    } else if (typeof maximum === "number" && !(upper && upper.value <= maximum)) {
        failed = "maximum";
    } else if (
        typeof exclusiveMaximum === "number" &&
        !(upper && exceeds(upper, exclusiveMaximum, -1))
    ) {
        failed = "exclusiveMaximum";
    }
    if (failed) {
        return { kind: "mismatch", keyword: failed, path: `${path}/${failed}` };
    }

    // Step sizes: proven only where division is exact, so the runtime check agrees.
    if (
        typeof multipleOf === "number" &&
        !isMultipleProven(producer, integral, lower, upper, multipleOf)
    ) {
        // A proper interval of fractions with no step of its own holds a value that isn't a
        // multiple of anything fixed; a stepped or single-point producer might still fit.
        const stepped = getProducerMultiples(producer, false).length > 0;
        const singlePoint =
            lower !== undefined && upper !== undefined && lower.value === upper.value;
        return {
            kind: integral || stepped || singlePoint ? "unprovable" : "mismatch",
            keyword: "multipleOf",
            path: `${path}/multipleOf`,
        };
    }
    return undefined;
}

/**
 * True when every producer value is provably a multiple of the consumer's
 * step. Only integer steps are compared, and only within the safe-integer
 * range: there, dividing an integer by an integer step is exact, which is
 * what the runtime check requires.
 */
function isMultipleProven(
    producer: Conjunction,
    integral: boolean,
    lower: NumericBound | undefined,
    upper: NumericBound | undefined,
    multipleOf: number,
): boolean {
    const bounded =
        lower !== undefined &&
        upper !== undefined &&
        Math.abs(lower.value) <= Number.MAX_SAFE_INTEGER &&
        Math.abs(upper.value) <= Number.MAX_SAFE_INTEGER;
    return (
        integral &&
        bounded &&
        Number.isInteger(multipleOf) &&
        getProducerMultiples(producer, integral).some(
            (step) => Number.isInteger(step) && step % multipleOf === 0,
        )
    );
}

/**
 * True when every value within `bound` lies strictly beyond `limit` in
 * the given direction: `1` for above a lower limit, `-1` for below an
 * upper one.
 */
function exceeds(bound: NumericBound, limit: number, direction: 1 | -1): boolean {
    const distance = (bound.value - limit) * direction;
    return distance > 0 || (distance === 0 && bound.exclusive);
}

/** A numeric bound and whether the bound value itself is excluded. */
interface NumericBound {
    /** The bound's value. */
    value: number;
    /** True when values must differ from `value`, not merely reach it. */
    exclusive: boolean;
}

/** Finds the producer's tightest lower or upper bound across its conjuncts. */
function getNumericBound(
    producer: Conjunction,
    inclusiveKeyword: "minimum" | "maximum",
    exclusiveKeyword: "exclusiveMinimum" | "exclusiveMaximum",
    integral: boolean,
): NumericBound | undefined {
    const isLower = inclusiveKeyword === "minimum";
    let tightest: NumericBound | undefined;
    for (const conjunct of producer) {
        for (const candidate of [
            { value: conjunct[inclusiveKeyword], exclusive: false },
            { value: conjunct[exclusiveKeyword], exclusive: true },
        ]) {
            if (typeof candidate.value !== "number") {
                continue;
            }
            let bound: NumericBound = { value: candidate.value, exclusive: candidate.exclusive };
            if (integral) {
                // Integers inside an exclusive or fractional bound start at the next whole number.
                bound = { value: getWholeBound(bound, isLower), exclusive: false };
            }
            if (!tightest || isTighter(bound, tightest, isLower)) {
                tightest = bound;
            }
        }
    }
    return tightest;
}

/** The closest whole number inside a bound, on the lower or upper side. */
function getWholeBound(bound: NumericBound, isLower: boolean): number {
    if (isLower) {
        return bound.exclusive ? Math.floor(bound.value) + 1 : Math.ceil(bound.value);
    }
    return bound.exclusive ? Math.ceil(bound.value) - 1 : Math.floor(bound.value);
}

/** True when `candidate` excludes at least as much as `current` on the given side. */
function isTighter(candidate: NumericBound, current: NumericBound, isLower: boolean): boolean {
    if (candidate.value !== current.value) {
        return isLower ? candidate.value > current.value : candidate.value < current.value;
    }
    return candidate.exclusive && !current.exclusive;
}

/** The step sizes every producer value is a multiple of; an integer producer is a multiple of 1. */
function getProducerMultiples(producer: Conjunction, integral: boolean): number[] {
    const steps = producer
        .map((conjunct) => conjunct.multipleOf)
        .filter((step): step is number => typeof step === "number");
    if (integral) {
        steps.push(1);
    }
    return steps;
}

/** Checks string keywords, which apply only when the producer can be a string. */
export function stringFits(
    producer: Conjunction,
    consumer: SchemaObject,
    path: string,
): ContainmentFailure | undefined {
    if (!getPossibleKinds(producer).has("string")) {
        return undefined;
    }
    if (
        typeof consumer.minLength === "number" &&
        getLowerBound(producer, "minLength") < consumer.minLength
    ) {
        return { kind: "mismatch", keyword: "minLength", path: `${path}/minLength` };
    }
    if (
        typeof consumer.maxLength === "number" &&
        getUpperBound(producer, "maxLength") > consumer.maxLength
    ) {
        return { kind: "mismatch", keyword: "maxLength", path: `${path}/maxLength` };
    }
    // Patterns can't be compared in general, so only an identical producer pattern proves one.
    if (
        typeof consumer.pattern === "string" &&
        !producer.some((conjunct) => conjunct.pattern === consumer.pattern)
    ) {
        return { kind: "unprovable", keyword: "pattern", path: `${path}/pattern` };
    }
    return undefined;
}

/** The largest lower bound any conjunct sets for a count keyword; 0 when none does. */
export function getLowerBound(producer: Conjunction, keyword: string): number {
    return Math.max(0, ...getKeywordNumbers(producer, keyword));
}

/** The smallest upper bound any conjunct sets for a count keyword; infinite when none does. */
export function getUpperBound(producer: Conjunction, keyword: string): number {
    return Math.min(Number.POSITIVE_INFINITY, ...getKeywordNumbers(producer, keyword));
}

/** Every numeric value the producer's conjuncts give one keyword. */
function getKeywordNumbers(producer: Conjunction, keyword: string): number[] {
    return producer
        .map((conjunct) => conjunct[keyword])
        .filter((value): value is number => typeof value === "number");
}

/** The most elements a producer array can hold, including a closed `prefixItems` tuple. */
export function getMaxItems(producer: Conjunction): number {
    let most = getUpperBound(producer, "maxItems");
    for (const conjunct of producer) {
        if (conjunct.items === false) {
            most = Math.min(most, readSchemaList(conjunct.prefixItems).length);
        }
    }
    return most;
}

/** The schema one producer conjunct applies to the array element at `index`. */
export function getElementSchema(conjunct: SchemaObject, index: number): JsonSchema {
    const prefix = readSchemaList(conjunct.prefixItems);
    if (index < prefix.length) {
        return prefix[index] ?? true;
    }
    return isJsonSchema(conjunct.items) ? conjunct.items : true;
}

/**
 * The member names a closed producer allows, or undefined when the
 * producer can hold members it doesn't name. A conjunct closes the
 * object with `additionalProperties: false`, unless `patternProperties`
 * (which the checker doesn't read) could admit other names.
 */
export function getClosedMemberNames(producer: Conjunction): Set<string> | undefined {
    let allowed: Set<string> | undefined;
    for (const conjunct of producer) {
        if (conjunct.additionalProperties !== false || conjunct.patternProperties !== undefined) {
            continue;
        }
        const names = new Set(readSchemaRecord(conjunct.properties).keys());
        allowed = allowed ? new Set([...allowed].filter((name) => names.has(name))) : names;
    }
    return allowed;
}

/** Every member name some producer conjunct describes. */
export function getDeclaredMemberNames(producer: Conjunction): Set<string> {
    return new Set(
        producer.flatMap((conjunct) => [...readSchemaRecord(conjunct.properties).keys()]),
    );
}

/** The schema one producer conjunct applies to the member `name`. */
export function getMemberSchema(conjunct: SchemaObject, name: string): JsonSchema {
    const named = readSchemaRecord(conjunct.properties).get(name);
    if (named !== undefined) {
        return named;
    }
    return getUnnamedMemberSchema(conjunct);
}

/** The schema one producer conjunct applies to members its `properties` don't name. */
export function getUnnamedMemberSchema(conjunct: SchemaObject): JsonSchema {
    if (conjunct.patternProperties !== undefined) {
        return true;
    }
    return isJsonSchema(conjunct.additionalProperties) ? conjunct.additionalProperties : true;
}

/** Consumer keywords whose mismatch a producer `pattern` could explain away, since it narrows strings. */
const PATTERN_SENSITIVE_KEYWORDS: ReadonlySet<string> = new Set([
    "minLength",
    "maxLength",
    "const",
    "enum",
]);

/**
 * True when a producer conjunction constrains values in ways the checker
 * doesn't reason about, so a mismatch found on `keyword` may not name a
 * value the producer allows: a keyword outside the comparable set, or,
 * for string keywords, a `pattern`, which the checker compares only by
 * identity.
 */
export function hasUncomparedConstraints(producer: Conjunction, keyword: string): boolean {
    return producer.some((conjunct) =>
        Object.keys(conjunct).some(
            (member) =>
                (member === "pattern" && PATTERN_SENSITIVE_KEYWORDS.has(keyword)) ||
                (!COMPARABLE_KEYWORDS.has(member) && !IGNORED_KEYWORDS.has(member)),
        ),
    );
}
