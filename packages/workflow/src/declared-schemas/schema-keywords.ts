import { canonicalize } from "../publish/canonical-json";
import { isJsonSchema, type JsonSchema } from "./declared-schema-compiler";

/**
 * The vocabulary the schema containment check reads JSON Schemas with:
 * its result and intermediate shapes, the keywords it ignores or can
 * compare, the value kinds `type` distinguishes, and tolerant readers for
 * keyword values. Readers never throw on a malformed keyword value; they
 * read it as absent, which the checker treats as the wider schema.
 */

/** The outcome of a containment check. */
export type ContainmentResult =
    | {
          /** Every value the producer allows, the consumer accepts. */
          kind: "contained";
      }
    | {
          /** Some value the producer allows fails the consumer. */
          kind: "mismatch" | "unprovable";
          /** The consumer keyword that failed or can't be compared, or the producer keyword that couldn't be expanded. */
          keyword: string;
          /** JSON Pointer inside the consumer schema to that keyword, or `""` for the whole schema. */
          path: string;
      };

/** A containment result that isn't a pass: the failing or incomparable keyword and its location. */
export type ContainmentFailure = Exclude<ContainmentResult, { kind: "contained" }>;

/** A schema object, as the checker reads it. */
export type SchemaObject = Readonly<Record<string, unknown>>;

/** One conjunction of producer schema objects; a value must satisfy all of them. */
export type Conjunction = readonly SchemaObject[];

/**
 * Producer alternatives: a value the producer allows satisfies at least
 * one conjunction. An empty list allows no value at all.
 */
export type Alternatives = readonly Conjunction[];

/** Keywords that describe a schema without constraining values; both sides ignore them. */
export const IGNORED_KEYWORDS: ReadonlySet<string> = new Set([
    "title",
    "description",
    "default",
    "examples",
    "$comment",
    "deprecated",
    "readOnly",
    "writeOnly",
    "format",
    "$schema",
    "$id",
    "$defs",
]);

/** Consumer keywords the checker can compare; any other constraining keyword makes a binding unprovable. */
export const COMPARABLE_KEYWORDS: ReadonlySet<string> = new Set([
    "type",
    "const",
    "enum",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "pattern",
    "items",
    "prefixItems",
    "minItems",
    "maxItems",
    "properties",
    "required",
    "additionalProperties",
    "minProperties",
    "maxProperties",
    "allOf",
    "anyOf",
    "$ref",
]);

/**
 * The value kinds JSON Schema's `type` distinguishes, with numbers split
 * so `integer` is a subset of `number`.
 */
export type ValueKind = "null" | "boolean" | "object" | "array" | "string" | "integer" | "fraction";

/** Every value kind: a schema without `type` allows all of them. */
export const ALL_KINDS: readonly ValueKind[] = [
    "null",
    "boolean",
    "object",
    "array",
    "string",
    "integer",
    "fraction",
];

/** Classifies a JSON value into the kinds `type` distinguishes. */
export function getValueKind(value: unknown): ValueKind {
    if (value === null) {
        return "null";
    }
    if (Array.isArray(value)) {
        return "array";
    }
    switch (typeof value) {
        case "boolean":
            return "boolean";
        case "string":
            return "string";
        case "number":
            return Number.isInteger(value) ? "integer" : "fraction";
        default:
            return "object";
    }
}

/** Returns the value kinds one `type` name allows; an unknown name allows none. */
export function getTypeKinds(type: string): readonly ValueKind[] {
    switch (type) {
        case "number":
            return ["integer", "fraction"];
        case "integer":
            return ["integer"];
        case "null":
        case "boolean":
        case "object":
        case "array":
        case "string":
            return [type];
        default:
            return [];
    }
}

/** Returns the `type` name that selects exactly one value kind, or its nearest superset for fractions. */
export function getKindTypeName(kind: ValueKind): string {
    return kind === "fraction" ? "number" : kind;
}

/** Reads a keyword's value as a list of schemas; anything else is an empty list. */
export function readSchemaList(value: unknown): JsonSchema[] {
    return Array.isArray(value) ? value.filter(isJsonSchema) : [];
}

/** Reads a `properties` value as named schemas, keeping author-chosen names exactly. */
export function readSchemaRecord(value: unknown): Map<string, JsonSchema> {
    const members = new Map<string, JsonSchema>();
    if (isObject(value)) {
        for (const [name, schema] of Object.entries(value)) {
            if (isJsonSchema(schema)) {
                members.set(name, schema);
            }
        }
    }
    return members;
}

/** Reads a keyword's value as a list of strings, dropping anything else. */
export function readStringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
}

/** Reads a `type` value as a list of type names. */
export function readTypeList(value: unknown): string[] {
    return typeof value === "string" ? [value] : readStringList(value);
}

/** True for a JSON object that isn't an array or null. */
export function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Compares two JSON values for equality, ignoring member order. */
export function isSameJson(a: unknown, b: unknown): boolean {
    return canonicalize(a) === canonicalize(b);
}
