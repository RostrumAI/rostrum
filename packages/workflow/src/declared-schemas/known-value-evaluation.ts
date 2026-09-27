import { RE2JS } from "re2js";
import { escapePointerToken } from "../json-source-map";
import { isJsonSchema, type JsonSchema } from "./declared-schema-compiler";
import {
    type ContainmentFailure,
    getTypeKinds,
    getValueKind,
    IGNORED_KEYWORDS,
    isObject,
    isSameJson,
    readSchemaList,
    readSchemaRecord,
    readStringList,
    readTypeList,
    type SchemaObject,
} from "./schema-keywords";
import type { ReferenceResolver } from "./schema-references";

/**
 * Evaluates known values against a consumer schema over the containment
 * check's comparable keyword set. The check uses it for a finite
 * producer, such as a `const`, an `enum`, or a short integer range, so
 * each value the producer allows is decided exactly rather than by
 * comparing keywords. A keyword outside the comparable set, or a
 * reference the resolver refuses, is unprovable.
 */
export class KnownValueEvaluator {
    private readonly references: ReferenceResolver;
    private readonly patterns = new Map<string, RE2JS>();

    /** Binds the evaluator to the resolver for the consumer document's local references. */
    constructor(references: ReferenceResolver) {
        this.references = references;
    }

    /**
     * Evaluates one known value against a consumer schema. Returns the
     * first keyword the value fails or can't be decided on, located at
     * `path` inside the consumer schema, or undefined when it passes.
     */
    evaluate(consumer: JsonSchema, value: unknown, path: string): ContainmentFailure | undefined {
        if (consumer === true) {
            return undefined;
        }
        if (consumer === false) {
            return { kind: "mismatch", keyword: "false", path };
        }
        for (const [keyword, expected] of Object.entries(consumer)) {
            if (IGNORED_KEYWORDS.has(keyword)) {
                continue;
            }
            const failure = this.evaluateKeyword(consumer, keyword, expected, value, path);
            if (failure) {
                return failure;
            }
        }
        return undefined;
    }

    /** Evaluates one consumer keyword against a known value. */
    private evaluateKeyword(
        consumer: SchemaObject,
        keyword: string,
        expected: unknown,
        value: unknown,
        path: string,
    ): ContainmentFailure | undefined {
        const at = `${path}/${escapePointerToken(keyword)}`;
        const mismatch: ContainmentFailure = { kind: "mismatch", keyword, path: at };
        switch (keyword) {
            case "type":
                return readTypeList(expected).some((type) =>
                    getTypeKinds(type).includes(getValueKind(value)),
                )
                    ? undefined
                    : mismatch;
            case "const":
                return isSameJson(expected, value) ? undefined : mismatch;
            case "enum":
                return Array.isArray(expected) &&
                    expected.some((member) => isSameJson(member, value))
                    ? undefined
                    : mismatch;
            case "minimum":
            case "maximum":
            case "exclusiveMinimum":
            case "exclusiveMaximum":
            case "multipleOf":
                return typeof value !== "number" || numberSatisfies(keyword, expected, value)
                    ? undefined
                    : mismatch;
            case "minLength":
            case "maxLength":
                return typeof value !== "string" || lengthSatisfies(keyword, expected, value)
                    ? undefined
                    : mismatch;
            case "pattern":
                return typeof value !== "string" ||
                    typeof expected !== "string" ||
                    this.compilePattern(expected).test(value)
                    ? undefined
                    : mismatch;
            case "minItems":
                return !Array.isArray(value) || value.length >= Number(expected)
                    ? undefined
                    : mismatch;
            case "maxItems":
                return !Array.isArray(value) || value.length <= Number(expected)
                    ? undefined
                    : mismatch;
            case "prefixItems":
            case "items":
                return Array.isArray(value)
                    ? this.evaluateElements(consumer, keyword, value, path)
                    : undefined;
            case "minProperties":
                return !isObject(value) || Object.keys(value).length >= Number(expected)
                    ? undefined
                    : mismatch;
            case "maxProperties":
                return !isObject(value) || Object.keys(value).length <= Number(expected)
                    ? undefined
                    : mismatch;
            case "required":
                return !isObject(value) ||
                    readStringList(expected).every((name) => Object.hasOwn(value, name))
                    ? undefined
                    : mismatch;
            case "properties":
            case "additionalProperties":
                return isObject(value)
                    ? this.evaluateMembers(consumer, keyword, value, path)
                    : undefined;
            case "allOf":
                return this.evaluateAllOf(expected, value, at);
            case "anyOf":
                return this.evaluateAnyOf(expected, value, at);
            case "$ref": {
                const target =
                    typeof expected === "string" ? this.references.resolve(expected) : undefined;
                return target === undefined
                    ? { kind: "unprovable", keyword, path: at }
                    : this.evaluate(target, value, path);
            }
            default:
                return { kind: "unprovable", keyword, path: at };
        }
    }

    /**
     * Compiles a pattern with the linear-time engine the runtime uses,
     * once per check, so a finite producer with many values doesn't
     * recompile it for each one.
     */
    private compilePattern(pattern: string): RE2JS {
        const known = this.patterns.get(pattern);
        if (known) {
            return known;
        }
        const compiled = RE2JS.compile(pattern);
        this.patterns.set(pattern, compiled);
        return compiled;
    }

    /** Evaluates `prefixItems` or `items` against a known array. */
    private evaluateElements(
        consumer: SchemaObject,
        keyword: "prefixItems" | "items",
        value: readonly unknown[],
        path: string,
    ): ContainmentFailure | undefined {
        const prefix = readSchemaList(consumer.prefixItems);
        for (const [index, element] of value.entries()) {
            const inPrefix = index < prefix.length;
            if (inPrefix !== (keyword === "prefixItems")) {
                continue;
            }
            const schema = inPrefix ? prefix[index] : consumer.items;
            const schemaPath = inPrefix ? `${path}/prefixItems/${index}` : `${path}/items`;
            const failure = isJsonSchema(schema)
                ? this.evaluate(schema, element, schemaPath)
                : undefined;
            if (failure) {
                return failure;
            }
        }
        return undefined;
    }

    /** Evaluates `properties` or `additionalProperties` against a known object. */
    private evaluateMembers(
        consumer: SchemaObject,
        keyword: "properties" | "additionalProperties",
        value: Readonly<Record<string, unknown>>,
        path: string,
    ): ContainmentFailure | undefined {
        const properties = readSchemaRecord(consumer.properties);
        for (const [name, member] of Object.entries(value)) {
            const named = properties.get(name);
            if (keyword === "properties" && named !== undefined) {
                const failure = this.evaluate(
                    named,
                    member,
                    `${path}/properties/${escapePointerToken(name)}`,
                );
                if (failure) {
                    return failure;
                }
            }
            const additional = consumer.additionalProperties;
            if (
                keyword === "additionalProperties" &&
                named === undefined &&
                isJsonSchema(additional)
            ) {
                const failure = this.evaluate(additional, member, `${path}/additionalProperties`);
                if (failure) {
                    return failure;
                }
            }
        }
        return undefined;
    }

    /** Evaluates `allOf`: the value must satisfy every member. */
    private evaluateAllOf(
        members: unknown,
        value: unknown,
        path: string,
    ): ContainmentFailure | undefined {
        for (const [index, member] of readSchemaList(members).entries()) {
            const failure = this.evaluate(member, value, `${path}/${index}`);
            if (failure) {
                return failure;
            }
        }
        return undefined;
    }

    /** Evaluates `anyOf`: the value must satisfy some member. */
    private evaluateAnyOf(
        members: unknown,
        value: unknown,
        path: string,
    ): ContainmentFailure | undefined {
        let unprovable: ContainmentFailure | undefined;
        for (const [index, member] of readSchemaList(members).entries()) {
            const failure = this.evaluate(member, value, `${path}/${index}`);
            if (!failure) {
                return undefined;
            }
            unprovable ??= failure.kind === "unprovable" ? failure : undefined;
        }
        return unprovable ?? { kind: "mismatch", keyword: "anyOf", path };
    }
}

/**
 * True when `value` is a multiple of `step` exactly as the runtime check
 * decides it: the quotient must survive integer parsing unchanged, so a
 * rounding error or an exponent-notation quotient fails.
 */
function isExactMultiple(value: number, step: number): boolean {
    const quotient = value / step;
    return Number.parseInt(String(quotient), 10) === quotient;
}

/** Checks one numeric keyword against a known number. */
function numberSatisfies(keyword: string, expected: unknown, value: number): boolean {
    if (typeof expected !== "number") {
        return true;
    }
    switch (keyword) {
        case "minimum":
            return value >= expected;
        case "maximum":
            return value <= expected;
        case "exclusiveMinimum":
            return value > expected;
        case "exclusiveMaximum":
            return value < expected;
        default:
            return isExactMultiple(value, expected);
    }
}

/** Checks a length keyword against a known string, counting code points as JSON Schema does. */
function lengthSatisfies(
    keyword: "minLength" | "maxLength",
    expected: unknown,
    value: string,
): boolean {
    if (typeof expected !== "number") {
        return true;
    }
    const length = [...value].length;
    return keyword === "minLength" ? length >= expected : length <= expected;
}
