import { RE2JS } from "re2js";
import { escapePointerToken } from "../json-source-map";
import { canonicalize } from "../publish/canonical-json";
import { isJsonSchema, type JsonSchema } from "./declared-schema-compiler";

/**
 * Decides whether every value one JSON Schema allows (the producer) is
 * also allowed by another (the consumer).
 *
 * Containment is proven keyword by keyword over a fixed comparable set,
 * not by a general schema reasoner. A consumer keyword outside that set
 * makes the answer unprovable and names the keyword. A producer keyword
 * outside the set is ignored, which only makes the producer look wider:
 * the check can refuse a pair that would always fit, but never passes
 * one that can fail. The module knows nothing about workflows.
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

/** Schemas whose local `$ref`s resolve against their own document roots. */
export interface ContainmentRoots {
    /** The document the producer's `$ref`s resolve against; defaults to the producer. */
    producerRoot?: JsonSchema;
    /** The document the consumer's `$ref`s resolve against; defaults to the consumer. */
    consumerRoot?: JsonSchema;
}

/** A schema object, as the checker reads it. */
type SchemaObject = Readonly<Record<string, unknown>>;

/** One conjunction of producer schema objects; a value must satisfy all of them. */
type Conjunction = readonly SchemaObject[];

/**
 * Producer alternatives: a value the producer allows satisfies at least
 * one conjunction. An empty list allows no value at all.
 */
type Alternatives = readonly Conjunction[];

/** A step result that isn't a pass: the failing or incomparable keyword and its location. */
type Failure = Exclude<ContainmentResult, { kind: "contained" }>;

/** Keywords that describe a schema without constraining values; both sides ignore them. */
const IGNORED_KEYWORDS: ReadonlySet<string> = new Set([
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

/** Consumer keywords the checker can compare; anything else makes a binding unprovable. */
const COMPARABLE_KEYWORDS: ReadonlySet<string> = new Set([
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

/** Producer keywords that expand into alternatives or conjunctions instead of constraining directly. */
const COMBINATOR_KEYWORDS: ReadonlySet<string> = new Set(["allOf", "anyOf", "oneOf", "$ref"]);

/**
 * The most producer alternatives the checker expands before giving up.
 * Each `anyOf` multiplies the alternatives, so a bound keeps a nested
 * schema from exploding into an unbounded comparison.
 */
const MAX_ALTERNATIVES = 64;

/**
 * The value kinds JSON Schema's `type` distinguishes, with numbers split
 * so `integer` is a subset of `number`.
 */
type ValueKind = "null" | "boolean" | "object" | "array" | "string" | "integer" | "fraction";

/** Every value kind: a schema without `type` allows all of them. */
const ALL_KINDS: readonly ValueKind[] = [
    "null",
    "boolean",
    "object",
    "array",
    "string",
    "integer",
    "fraction",
];

/** Thrown when the producer expands into more alternatives than the checker compares. */
class ExpansionLimitError extends Error {
    /** The combinator keyword whose expansion passed the limit. */
    readonly keyword: string;

    /** Records the combinator keyword whose expansion passed the limit. */
    constructor(keyword: string) {
        super(`Producer expansion through '${keyword}' exceeded ${MAX_ALTERNATIVES} alternatives`);
        this.name = "ExpansionLimitError";
        this.keyword = keyword;
    }
}

/**
 * Checks whether the producer schema is contained in the consumer schema.
 * Both schemas must already have compiled; the checker doesn't repeat
 * meta-schema validation.
 */
export function checkSchemaContainment(
    producer: JsonSchema,
    consumer: JsonSchema,
    roots: ContainmentRoots = {},
): ContainmentResult {
    const checker = new ContainmentChecker(
        roots.producerRoot ?? producer,
        roots.consumerRoot ?? consumer,
    );
    return checker.check(producer, consumer);
}

/** Resolves local references and compares one producer against one consumer. */
class ContainmentChecker {
    private readonly producerRefs: ReferenceResolver;
    private readonly consumerRefs: ReferenceResolver;

    /** Binds the checker to the documents each side's references resolve against. */
    constructor(producerRoot: JsonSchema, consumerRoot: JsonSchema) {
        this.producerRefs = new ReferenceResolver(producerRoot);
        this.consumerRefs = new ReferenceResolver(consumerRoot);
    }

    /** Expands the producer and requires every alternative to fit the consumer. */
    check(producer: JsonSchema, consumer: JsonSchema): ContainmentResult {
        let alternatives: Alternatives;
        try {
            alternatives = this.expand(producer);
        } catch (error) {
            if (error instanceof ExpansionLimitError) {
                return { kind: "unprovable", keyword: error.keyword, path: "" };
            }
            throw error;
        }
        return this.alternativesFit(alternatives, consumer, "") ?? { kind: "contained" };
    }

    /**
     * Normalizes a producer schema into alternatives of conjunctions:
     * `allOf` joins, `anyOf` and `oneOf` split (reading `oneOf` as `anyOf`
     * only widens it), and local non-recursive `$ref` inlines. A recursive
     * or non-local reference is read as `true`, which is wider.
     */
    private expand(schema: JsonSchema): Alternatives {
        if (schema === true) {
            return [[]];
        }
        if (schema === false) {
            return [];
        }

        // The keywords that constrain directly form the base conjunct.
        const base: Record<string, unknown> = {};
        for (const [keyword, value] of Object.entries(schema)) {
            if (!COMBINATOR_KEYWORDS.has(keyword)) {
                base[keyword] = value;
            }
        }
        let alternatives: Alternatives = [[base]];

        // Each combinator narrows or splits the alternatives found so far.
        const reference = schema.$ref;
        if (typeof reference === "string") {
            const target = this.producerRefs.resolve(reference);
            if (target !== undefined) {
                alternatives = combine(alternatives, this.expand(target), "$ref");
            }
        }
        for (const member of schemaList(schema.allOf)) {
            alternatives = combine(alternatives, this.expand(member), "allOf");
        }
        for (const keyword of ["anyOf", "oneOf"] as const) {
            const members = schemaList(schema[keyword]);
            if (members.length > 0) {
                const union = members.flatMap((member) => this.expand(member));
                alternatives = combine(alternatives, union, keyword);
            }
        }
        return alternatives;
    }

    /** Requires every producer alternative to fit the consumer; returns the first failure. */
    private alternativesFit(
        alternatives: Alternatives,
        consumer: JsonSchema,
        path: string,
    ): Failure | undefined {
        for (const conjunction of alternatives) {
            if (possibleKinds(conjunction).size === 0) {
                // No value satisfies this alternative, so it constrains nothing.
                continue;
            }
            const failure = this.conjunctionFits(conjunction, consumer, path);
            if (failure) {
                return failure;
            }
        }
        return undefined;
    }

    /** Checks one producer conjunction against one consumer schema. */
    private conjunctionFits(
        producer: Conjunction,
        consumer: JsonSchema,
        path: string,
    ): Failure | undefined {
        if (consumer === true) {
            return undefined;
        }
        if (consumer === false) {
            return { kind: "mismatch", keyword: "false", path };
        }

        // An incomparable consumer keyword blocks the binding before any comparison.
        for (const keyword of Object.keys(consumer)) {
            if (!IGNORED_KEYWORDS.has(keyword) && !COMPARABLE_KEYWORDS.has(keyword)) {
                return {
                    kind: "unprovable",
                    keyword,
                    path: `${path}/${escapePointerToken(keyword)}`,
                };
            }
        }

        // A finite producer is checked value by value, which is exact.
        const values = finiteValues(producer);
        if (values) {
            for (const value of values) {
                const failure = this.evaluate(consumer, value, path);
                if (failure) {
                    return failure;
                }
            }
            return undefined;
        }

        return (
            this.referenceFits(producer, consumer, path) ??
            this.combinatorsFit(producer, consumer, path) ??
            typeFits(producer, consumer, path) ??
            enumerationFits(consumer, path) ??
            numberFits(producer, consumer, path) ??
            stringFits(producer, consumer, path) ??
            this.arrayFits(producer, consumer, path) ??
            this.objectFits(producer, consumer, path)
        );
    }

    /** Inlines a consumer's local, non-recursive `$ref`; anything else is unprovable. */
    private referenceFits(
        producer: Conjunction,
        consumer: SchemaObject,
        path: string,
    ): Failure | undefined {
        const reference = consumer.$ref;
        if (typeof reference !== "string") {
            return undefined;
        }
        const target = this.consumerRefs.resolve(reference);
        if (target === undefined) {
            return { kind: "unprovable", keyword: "$ref", path: `${path}/$ref` };
        }
        return this.conjunctionFits(producer, target, path);
    }

    /** Checks the consumer's `allOf` (every member) and `anyOf` (some member). */
    private combinatorsFit(
        producer: Conjunction,
        consumer: SchemaObject,
        path: string,
    ): Failure | undefined {
        for (const [index, member] of schemaList(consumer.allOf).entries()) {
            const failure = this.conjunctionFits(producer, member, `${path}/allOf/${index}`);
            if (failure) {
                return failure;
            }
        }

        const members = schemaList(consumer.anyOf);
        if (members.length === 0) {
            return undefined;
        }
        let unprovable: Failure | undefined;
        for (const [index, member] of members.entries()) {
            const failure = this.conjunctionFits(producer, member, `${path}/anyOf/${index}`);
            if (!failure) {
                return undefined;
            }
            unprovable ??= failure.kind === "unprovable" ? failure : undefined;
        }
        // No member fits. If one couldn't be compared, the answer is unknown, not a mismatch.
        return unprovable ?? { kind: "mismatch", keyword: "anyOf", path: `${path}/anyOf` };
    }

    /** Checks array keywords, which apply only when the producer can be an array. */
    private arrayFits(
        producer: Conjunction,
        consumer: SchemaObject,
        path: string,
    ): Failure | undefined {
        if (!possibleKinds(producer).has("array")) {
            return undefined;
        }

        // Length bounds: the producer's own bounds must sit inside the consumer's.
        const producerMaxItems = maxItemsOf(producer);
        if (
            typeof consumer.minItems === "number" &&
            lowerBound(producer, "minItems") < consumer.minItems
        ) {
            return { kind: "mismatch", keyword: "minItems", path: `${path}/minItems` };
        }
        if (typeof consumer.maxItems === "number" && producerMaxItems > consumer.maxItems) {
            return { kind: "mismatch", keyword: "maxItems", path: `${path}/maxItems` };
        }

        // Element schemas: compare every position where the two sides can
        // differ, then one representative position for the tail that
        // follows every `prefixItems` list.
        const consumerPrefix = schemaList(consumer.prefixItems);
        if (consumerPrefix.length === 0 && consumer.items === undefined) {
            return undefined;
        }
        const tailIndex = Math.max(
            consumerPrefix.length,
            ...producer.map((conjunct) => schemaList(conjunct.prefixItems).length),
        );
        for (let index = 0; index <= tailIndex; index++) {
            if (index >= producerMaxItems) {
                break;
            }
            const consumerElement =
                index < consumerPrefix.length
                    ? { schema: consumerPrefix[index], path: `${path}/prefixItems/${index}` }
                    : { schema: consumer.items, path: `${path}/items` };
            if (consumerElement.schema === undefined) {
                continue;
            }
            const failure = this.alternativesFit(
                this.expandAll(producer.map((conjunct) => elementSchema(conjunct, index))),
                consumerElement.schema as JsonSchema,
                consumerElement.path,
            );
            if (failure) {
                return failure;
            }
        }
        return undefined;
    }

    /** Checks object keywords, which apply only when the producer can be an object. */
    private objectFits(
        producer: Conjunction,
        consumer: SchemaObject,
        path: string,
    ): Failure | undefined {
        if (!possibleKinds(producer).has("object")) {
            return undefined;
        }

        // Required members: some producer conjunct must require each one.
        const producerRequired = new Set(
            producer.flatMap((conjunct) => stringList(conjunct.required)),
        );
        for (const [index, name] of stringList(consumer.required).entries()) {
            if (!producerRequired.has(name)) {
                return { kind: "mismatch", keyword: "required", path: `${path}/required/${index}` };
            }
        }

        // Member counts: a closed producer can't exceed the members it allows.
        const allowedNames = closedMemberNames(producer);
        const producerMinProperties = Math.max(
            lowerBound(producer, "minProperties"),
            producerRequired.size,
        );
        const producerMaxProperties = Math.min(
            upperBound(producer, "maxProperties"),
            allowedNames?.size ?? Number.POSITIVE_INFINITY,
        );
        if (
            typeof consumer.minProperties === "number" &&
            producerMinProperties < consumer.minProperties
        ) {
            return { kind: "mismatch", keyword: "minProperties", path: `${path}/minProperties` };
        }
        if (
            typeof consumer.maxProperties === "number" &&
            producerMaxProperties > consumer.maxProperties
        ) {
            return { kind: "mismatch", keyword: "maxProperties", path: `${path}/maxProperties` };
        }

        // Named members the consumer describes, where the producer can supply them.
        const consumerProperties = schemaRecord(consumer.properties);
        for (const [name, schema] of consumerProperties) {
            if (allowedNames && !allowedNames.has(name)) {
                continue;
            }
            const failure = this.alternativesFit(
                this.expandAll(producer.map((conjunct) => memberSchema(conjunct, name))),
                schema,
                `${path}/properties/${escapePointerToken(name)}`,
            );
            if (failure) {
                return failure;
            }
        }

        // Members the consumer doesn't name must satisfy its additionalProperties.
        const additional = consumer.additionalProperties;
        if (additional === undefined) {
            return undefined;
        }
        const additionalPath = `${path}/additionalProperties`;
        const producerNames = allowedNames ?? declaredMemberNames(producer);
        for (const name of producerNames) {
            if (consumerProperties.has(name)) {
                continue;
            }
            const failure = this.alternativesFit(
                this.expandAll(producer.map((conjunct) => memberSchema(conjunct, name))),
                additional as JsonSchema,
                additionalPath,
            );
            if (failure) {
                return failure;
            }
        }
        if (allowedNames) {
            return undefined;
        }
        // An open producer can also supply members nobody named.
        return this.alternativesFit(
            this.expandAll(producer.map((conjunct) => unnamedMemberSchema(conjunct))),
            additional as JsonSchema,
            additionalPath,
        );
    }

    /** Expands and joins several producer schemas that all apply to the same value. */
    private expandAll(schemas: readonly JsonSchema[]): Alternatives {
        let alternatives: Alternatives = [[]];
        for (const schema of schemas) {
            alternatives = combine(alternatives, this.expand(schema), "allOf");
        }
        return alternatives;
    }

    /**
     * Evaluates one known value against a consumer schema over the
     * comparable keyword set. Finite producers use it so each of their
     * values is checked exactly.
     */
    private evaluate(consumer: JsonSchema, value: unknown, path: string): Failure | undefined {
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
    ): Failure | undefined {
        const at = `${path}/${escapePointerToken(keyword)}`;
        const mismatch: Failure = { kind: "mismatch", keyword, path: at };
        switch (keyword) {
            case "type":
                return typeList(expected).some((type) => kindsOfType(type).includes(kindOf(value)))
                    ? undefined
                    : mismatch;
            case "const":
                return sameJson(expected, value) ? undefined : mismatch;
            case "enum":
                return Array.isArray(expected) && expected.some((member) => sameJson(member, value))
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
            case "pattern":
                return typeof value !== "string" || stringSatisfies(keyword, expected, value)
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
                    stringList(expected).every((name) => Object.hasOwn(value, name))
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
                    typeof expected === "string" ? this.consumerRefs.resolve(expected) : undefined;
                return target === undefined
                    ? { kind: "unprovable", keyword, path: at }
                    : this.evaluate(target, value, path);
            }
            default:
                return { kind: "unprovable", keyword, path: at };
        }
    }

    /** Evaluates `prefixItems` or `items` against a known array. */
    private evaluateElements(
        consumer: SchemaObject,
        keyword: "prefixItems" | "items",
        value: readonly unknown[],
        path: string,
    ): Failure | undefined {
        const prefix = schemaList(consumer.prefixItems);
        for (const [index, element] of value.entries()) {
            const inPrefix = index < prefix.length;
            if (inPrefix !== (keyword === "prefixItems")) {
                continue;
            }
            const schema = inPrefix ? prefix[index] : (consumer.items as JsonSchema);
            const schemaPath = inPrefix ? `${path}/prefixItems/${index}` : `${path}/items`;
            const failure =
                schema === undefined ? undefined : this.evaluate(schema, element, schemaPath);
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
    ): Failure | undefined {
        const properties = schemaRecord(consumer.properties);
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
            if (keyword === "additionalProperties" && named === undefined) {
                const failure = this.evaluate(
                    consumer.additionalProperties as JsonSchema,
                    member,
                    `${path}/additionalProperties`,
                );
                if (failure) {
                    return failure;
                }
            }
        }
        return undefined;
    }

    /** Evaluates `allOf`: the value must satisfy every member. */
    private evaluateAllOf(members: unknown, value: unknown, path: string): Failure | undefined {
        for (const [index, member] of schemaList(members).entries()) {
            const failure = this.evaluate(member, value, `${path}/${index}`);
            if (failure) {
                return failure;
            }
        }
        return undefined;
    }

    /** Evaluates `anyOf`: the value must satisfy some member. */
    private evaluateAnyOf(members: unknown, value: unknown, path: string): Failure | undefined {
        let unprovable: Failure | undefined;
        for (const [index, member] of schemaList(members).entries()) {
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
 * Resolves local JSON Pointer references (`#`, `#/$defs/name`) inside one
 * schema document, and refuses references that are external or that
 * lead back to themselves.
 */
class ReferenceResolver {
    private readonly root: JsonSchema;
    private readonly recursive = new Map<string, boolean>();

    /** Binds the resolver to the document references point into. */
    constructor(root: JsonSchema) {
        this.root = root;
    }

    /**
     * Returns the schema a local, non-recursive reference points to, or
     * undefined for an external, dangling, or recursive reference.
     */
    resolve(reference: string): JsonSchema | undefined {
        const target = this.lookup(reference);
        if (target === undefined || this.isRecursive(reference)) {
            return undefined;
        }
        return target;
    }

    /** Follows a `#`-prefixed JSON Pointer from the root. */
    private lookup(reference: string): JsonSchema | undefined {
        if (!reference.startsWith("#")) {
            return undefined;
        }
        let current: unknown = this.root;
        const pointer = reference.slice(1);
        if (pointer !== "" && !pointer.startsWith("/")) {
            return undefined;
        }
        for (const token of pointer === "" ? [] : pointer.slice(1).split("/")) {
            const key = decodeURIComponent(token).replaceAll("~1", "/").replaceAll("~0", "~");
            if (!isObject(current) && !Array.isArray(current)) {
                return undefined;
            }
            if (!Object.hasOwn(current, key)) {
                return undefined;
            }
            current = (current as Record<string, unknown>)[key];
        }
        return isJsonSchema(current) ? current : undefined;
    }

    /** True when the reference's target can reach the same reference again. */
    private isRecursive(reference: string): boolean {
        const known = this.recursive.get(reference);
        if (known !== undefined) {
            return known;
        }
        const target = this.lookup(reference);
        const recursive = target !== undefined && this.reaches(target, reference, new Set());
        this.recursive.set(reference, recursive);
        return recursive;
    }

    /** Walks a schema, following references, looking for the given reference. */
    private reaches(schema: unknown, reference: string, followed: Set<string>): boolean {
        if (Array.isArray(schema)) {
            return schema.some((member) => this.reaches(member, reference, followed));
        }
        if (!isObject(schema)) {
            return false;
        }
        for (const [keyword, value] of Object.entries(schema)) {
            if (keyword === "$ref" && typeof value === "string") {
                if (value === reference) {
                    return true;
                }
                if (!followed.has(value)) {
                    followed.add(value);
                    if (this.reaches(this.lookup(value), reference, followed)) {
                        return true;
                    }
                }
                continue;
            }
            // Literal values and unused definitions can't apply a reference.
            if (
                keyword === "const" ||
                keyword === "enum" ||
                keyword === "$defs" ||
                IGNORED_KEYWORDS.has(keyword)
            ) {
                continue;
            }
            if (this.reaches(value, reference, followed)) {
                return true;
            }
        }
        return false;
    }
}

/** Joins two alternative sets: every pairing of their conjunctions, within the limit. */
function combine(left: Alternatives, right: Alternatives, keyword: string): Alternatives {
    const joined: Conjunction[] = [];
    for (const a of left) {
        for (const b of right) {
            joined.push([...a, ...b]);
            if (joined.length > MAX_ALTERNATIVES) {
                throw new ExpansionLimitError(keyword);
            }
        }
    }
    return joined;
}

/** Reads a keyword's value as a list of schemas; anything else is an empty list. */
function schemaList(value: unknown): JsonSchema[] {
    return Array.isArray(value) ? value.filter(isJsonSchema) : [];
}

/** Reads a `properties` value as named schemas, keeping author-chosen names exactly. */
function schemaRecord(value: unknown): Map<string, JsonSchema> {
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

/** Reads a keyword's value as a list of strings. */
function stringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
}

/** Reads a `type` value as a list of type names. */
function typeList(value: unknown): string[] {
    return typeof value === "string" ? [value] : stringList(value);
}

/** True for a JSON object that isn't an array or null. */
function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Compares two JSON values for equality, ignoring member order. */
function sameJson(a: unknown, b: unknown): boolean {
    return canonicalize(a) === canonicalize(b);
}

/** Classifies a JSON value into the kinds `type` distinguishes. */
function kindOf(value: unknown): ValueKind {
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

/** The value kinds one `type` name allows. */
function kindsOfType(type: string): readonly ValueKind[] {
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

/**
 * The value kinds a producer conjunction can take: the intersection of
 * every conjunct's `type`. An integer `multipleOf` rules out fractions.
 */
function possibleKinds(producer: Conjunction): Set<ValueKind> {
    let kinds = new Set<ValueKind>(ALL_KINDS);
    for (const conjunct of producer) {
        if (conjunct.type !== undefined) {
            const allowed = new Set(typeList(conjunct.type).flatMap(kindsOfType));
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
function finiteValues(producer: Conjunction): unknown[] | undefined {
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
                ? values.filter((value) => allowed.some((other) => sameJson(value, other)))
                : [...allowed];
        }
    }

    // Other producer keywords narrow the set further, but ignoring them
    // only keeps extra values, which is the safe direction.
    const kinds = possibleKinds(producer);
    if (values) {
        return values.filter((value) => kinds.has(kindOf(value)));
    }
    if ([...kinds].every((kind) => kind === "null" || kind === "boolean")) {
        const finite: unknown[] = [];
        if (kinds.has("null")) {
            finite.push(null);
        }
        if (kinds.has("boolean")) {
            finite.push(true, false);
        }
        return finite;
    }
    return undefined;
}

/** Checks the consumer's `type` against the kinds the producer can take. */
function typeFits(
    producer: Conjunction,
    consumer: SchemaObject,
    path: string,
): Failure | undefined {
    if (consumer.type === undefined) {
        return undefined;
    }
    const accepted = new Set(typeList(consumer.type).flatMap(kindsOfType));
    for (const kind of possibleKinds(producer)) {
        if (!accepted.has(kind)) {
            return { kind: "mismatch", keyword: "type", path: `${path}/type` };
        }
    }
    return undefined;
}

/** A consumer `const` or `enum` can only hold an infinite producer's values by accident. */
function enumerationFits(consumer: SchemaObject, path: string): Failure | undefined {
    for (const keyword of ["const", "enum"] as const) {
        if (Object.hasOwn(consumer, keyword)) {
            return { kind: "mismatch", keyword, path: `${path}/${keyword}` };
        }
    }
    return undefined;
}

/** Checks numeric keywords, which apply only when the producer can be a number. */
function numberFits(
    producer: Conjunction,
    consumer: SchemaObject,
    path: string,
): Failure | undefined {
    const kinds = possibleKinds(producer);
    if (!kinds.has("integer") && !kinds.has("fraction")) {
        return undefined;
    }
    const integral = !kinds.has("fraction");

    // Bounds: the producer's tightest bound on each side must sit inside the consumer's.
    const lower = numericBound(producer, "minimum", "exclusiveMinimum", integral);
    const upper = numericBound(producer, "maximum", "exclusiveMaximum", integral);
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
    } else if (
        typeof multipleOf === "number" &&
        !producerMultiples(producer, integral).some((step) => isMultiple(step, multipleOf))
    ) {
        // A multiple of a multiple is a multiple, so one producer step size suffices.
        failed = "multipleOf";
    }
    return failed ? { kind: "mismatch", keyword: failed, path: `${path}/${failed}` } : undefined;
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
function numericBound(
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
                bound = { value: wholeBound(bound, isLower), exclusive: false };
            }
            if (!tightest || isTighter(bound, tightest, isLower)) {
                tightest = bound;
            }
        }
    }
    return tightest;
}

/** The closest whole number inside a bound, on the lower or upper side. */
function wholeBound(bound: NumericBound, isLower: boolean): number {
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
function producerMultiples(producer: Conjunction, integral: boolean): number[] {
    const steps = producer
        .map((conjunct) => conjunct.multipleOf)
        .filter((step): step is number => typeof step === "number");
    if (integral) {
        steps.push(1);
    }
    return steps;
}

/** True when `value` is a whole multiple of `step`, tolerating binary floating-point error. */
function isMultiple(value: number, step: number): boolean {
    const quotient = value / step;
    return Math.abs(quotient - Math.round(quotient)) < 1e-9;
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
            return isMultiple(value, expected);
    }
}

/** Checks string keywords, which apply only when the producer can be a string. */
function stringFits(
    producer: Conjunction,
    consumer: SchemaObject,
    path: string,
): Failure | undefined {
    if (!possibleKinds(producer).has("string")) {
        return undefined;
    }
    if (
        typeof consumer.minLength === "number" &&
        lowerBound(producer, "minLength") < consumer.minLength
    ) {
        return { kind: "mismatch", keyword: "minLength", path: `${path}/minLength` };
    }
    if (
        typeof consumer.maxLength === "number" &&
        upperBound(producer, "maxLength") > consumer.maxLength
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

/** Checks one string keyword against a known string; lengths count code points. */
function stringSatisfies(keyword: string, expected: unknown, value: string): boolean {
    switch (keyword) {
        case "minLength":
            return typeof expected !== "number" || [...value].length >= expected;
        case "maxLength":
            return typeof expected !== "number" || [...value].length <= expected;
        default:
            return typeof expected !== "string" || RE2JS.compile(expected).test(value);
    }
}

/** The largest lower bound any conjunct sets for a count keyword; 0 when none does. */
function lowerBound(producer: Conjunction, keyword: string): number {
    return Math.max(0, ...numbersOf(producer, keyword));
}

/** The smallest upper bound any conjunct sets for a count keyword; infinite when none does. */
function upperBound(producer: Conjunction, keyword: string): number {
    return Math.min(Number.POSITIVE_INFINITY, ...numbersOf(producer, keyword));
}

/** Every numeric value the producer's conjuncts give one keyword. */
function numbersOf(producer: Conjunction, keyword: string): number[] {
    return producer
        .map((conjunct) => conjunct[keyword])
        .filter((value): value is number => typeof value === "number");
}

/** The most elements a producer array can hold, including a closed `prefixItems` tuple. */
function maxItemsOf(producer: Conjunction): number {
    let most = upperBound(producer, "maxItems");
    for (const conjunct of producer) {
        if (conjunct.items === false) {
            most = Math.min(most, schemaList(conjunct.prefixItems).length);
        }
    }
    return most;
}

/** The schema one producer conjunct applies to the array element at `index`. */
function elementSchema(conjunct: SchemaObject, index: number): JsonSchema {
    const prefix = schemaList(conjunct.prefixItems);
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
function closedMemberNames(producer: Conjunction): Set<string> | undefined {
    let allowed: Set<string> | undefined;
    for (const conjunct of producer) {
        if (conjunct.additionalProperties !== false || conjunct.patternProperties !== undefined) {
            continue;
        }
        const names = new Set(schemaRecord(conjunct.properties).keys());
        allowed = allowed ? new Set([...allowed].filter((name) => names.has(name))) : names;
    }
    return allowed;
}

/** Every member name some producer conjunct describes. */
function declaredMemberNames(producer: Conjunction): Set<string> {
    return new Set(producer.flatMap((conjunct) => [...schemaRecord(conjunct.properties).keys()]));
}

/** The schema one producer conjunct applies to the member `name`. */
function memberSchema(conjunct: SchemaObject, name: string): JsonSchema {
    const named = schemaRecord(conjunct.properties).get(name);
    if (named !== undefined) {
        return named;
    }
    return unnamedMemberSchema(conjunct);
}

/** The schema one producer conjunct applies to members its `properties` don't name. */
function unnamedMemberSchema(conjunct: SchemaObject): JsonSchema {
    if (conjunct.patternProperties !== undefined) {
        return true;
    }
    return isJsonSchema(conjunct.additionalProperties) ? conjunct.additionalProperties : true;
}
