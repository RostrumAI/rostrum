import { escapePointerToken } from "../json-source-map";
import { isJsonSchema, type JsonSchema } from "./declared-schema-compiler";
import { KnownValueEvaluator } from "./known-value-evaluation";
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
import {
    type Alternatives,
    COMPARABLE_KEYWORDS,
    type Conjunction,
    type ContainmentFailure,
    type ContainmentResult,
    getKindTypeName,
    IGNORED_KEYWORDS,
    readSchemaList,
    readSchemaRecord,
    readStringList,
    type SchemaObject,
} from "./schema-keywords";
import { ReferenceResolver } from "./schema-references";

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

/** Schemas whose local `$ref`s resolve against their own document roots. */
export interface ContainmentRoots {
    /** The document the producer's `$ref`s resolve against; defaults to the producer. */
    producerRoot?: JsonSchema;
    /** The document the consumer's `$ref`s resolve against; defaults to the consumer. */
    consumerRoot?: JsonSchema;
}

/** Producer keywords that expand into alternatives or conjunctions instead of constraining directly. */
const COMBINATOR_KEYWORDS: ReadonlySet<string> = new Set(["allOf", "anyOf", "oneOf", "$ref"]);

/**
 * The most producer alternatives the checker expands before giving up.
 * Each `anyOf` multiplies the alternatives, so a bound keeps a nested
 * schema from exploding into an unbounded comparison.
 */
const MAX_ALTERNATIVES = 64;

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
    private readonly consumerValues: KnownValueEvaluator;
    private readonly producerValues: KnownValueEvaluator;

    /** Binds the checker to the documents each side's references resolve against. */
    constructor(producerRoot: JsonSchema, consumerRoot: JsonSchema) {
        this.producerRefs = new ReferenceResolver(producerRoot);
        this.consumerRefs = new ReferenceResolver(consumerRoot);
        this.consumerValues = new KnownValueEvaluator(this.consumerRefs);
        this.producerValues = new KnownValueEvaluator(this.producerRefs);
    }

    /**
     * Expands the producer and requires every alternative to fit the
     * consumer. Nested array items and object members expand during the
     * comparison, so the expansion limit can be reached anywhere in it.
     */
    check(producer: JsonSchema, consumer: JsonSchema): ContainmentResult {
        try {
            const alternatives = this.expand(producer);
            return this.alternativesFit(alternatives, consumer, "") ?? { kind: "contained" };
        } catch (error) {
            if (error instanceof ExpansionLimitError) {
                return { kind: "unprovable", keyword: error.keyword, path: "" };
            }
            throw error;
        }
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
                alternatives = combineAlternatives(alternatives, this.expand(target), "$ref");
            }
        }
        for (const member of readSchemaList(schema.allOf)) {
            alternatives = combineAlternatives(alternatives, this.expand(member), "allOf");
        }
        for (const keyword of ["anyOf", "oneOf"] as const) {
            const members = readSchemaList(schema[keyword]);
            if (members.length > 0) {
                const union = members.flatMap((member) => this.expand(member));
                alternatives = combineAlternatives(alternatives, union, keyword);
            }
        }
        return alternatives;
    }

    /** Requires every producer alternative to fit the consumer; returns the first failure. */
    private alternativesFit(
        alternatives: Alternatives,
        consumer: JsonSchema,
        path: string,
    ): ContainmentFailure | undefined {
        for (const conjunction of alternatives) {
            if (getPossibleKinds(conjunction).size === 0) {
                // No value satisfies this alternative, so it constrains nothing.
                continue;
            }
            const failure = this.conjunctionFits(conjunction, consumer, path);
            if (
                failure?.kind === "mismatch" &&
                hasUncomparedConstraints(conjunction, failure.keyword)
            ) {
                // The failing value might be one the ignored constraints exclude.
                return { ...failure, kind: "unprovable" };
            }
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
    ): ContainmentFailure | undefined {
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

        // A finite producer is checked value by value, which is exact. The candidates come
        // from const, enum, and type alone, so values the producer's other keywords exclude
        // are dropped first; a value the producer can't be decided on is kept.
        const values = getFiniteValues(producer)?.filter((value) =>
            producer.every(
                (conjunct) =>
                    this.producerValues.evaluate(conjunct, value, "")?.kind !== "mismatch",
            ),
        );
        if (values) {
            for (const value of values) {
                const failure = this.consumerValues.evaluate(consumer, value, path);
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
            enumerationFits(producer, consumer, path) ??
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
    ): ContainmentFailure | undefined {
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
    ): ContainmentFailure | undefined {
        for (const [index, member] of readSchemaList(consumer.allOf).entries()) {
            const failure = this.conjunctionFits(producer, member, `${path}/allOf/${index}`);
            if (failure) {
                return failure;
            }
        }

        // Each kind of value the producer allows may fit a different member.
        const members = readSchemaList(consumer.anyOf);
        if (members.length === 0) {
            return undefined;
        }
        for (const kind of getPossibleKinds(producer)) {
            const failure = this.someMemberFits(
                [...producer, { type: getKindTypeName(kind) }],
                members,
                path,
            );
            if (failure) {
                return failure;
            }
        }
        return undefined;
    }

    /**
     * Requires the producer to fit at least one `anyOf` member. When none
     * fits, the result is a mismatch only if every member rejects the
     * producer's type outright; otherwise the producer might be split
     * across members, which the checker can't prove either way.
     */
    private someMemberFits(
        producer: Conjunction,
        members: readonly JsonSchema[],
        path: string,
    ): ContainmentFailure | undefined {
        let everyTypeRejected = true;
        for (const [index, member] of members.entries()) {
            const failure = this.conjunctionFits(producer, member, `${path}/anyOf/${index}`);
            if (!failure) {
                return undefined;
            }
            // Only the member's own `type` rejects the producer outright; a nested one doesn't.
            everyTypeRejected &&=
                failure.kind === "mismatch" && failure.path === `${path}/anyOf/${index}/type`;
        }
        return {
            kind: everyTypeRejected ? "mismatch" : "unprovable",
            keyword: "anyOf",
            path: `${path}/anyOf`,
        };
    }

    /** Checks array keywords, which apply only when the producer can be an array. */
    private arrayFits(
        producer: Conjunction,
        consumer: SchemaObject,
        path: string,
    ): ContainmentFailure | undefined {
        if (!getPossibleKinds(producer).has("array")) {
            return undefined;
        }

        // Length bounds: the producer's own bounds must sit inside the consumer's.
        const producerMaxItems = getMaxItems(producer);
        if (
            typeof consumer.minItems === "number" &&
            getLowerBound(producer, "minItems") < consumer.minItems
        ) {
            return { kind: "mismatch", keyword: "minItems", path: `${path}/minItems` };
        }
        if (typeof consumer.maxItems === "number" && producerMaxItems > consumer.maxItems) {
            return { kind: "mismatch", keyword: "maxItems", path: `${path}/maxItems` };
        }

        // Element schemas: compare every position where the two sides can
        // differ, then one representative position for the tail that
        // follows every `prefixItems` list.
        const consumerPrefix = readSchemaList(consumer.prefixItems);
        if (consumerPrefix.length === 0 && consumer.items === undefined) {
            return undefined;
        }
        const tailIndex = Math.max(
            consumerPrefix.length,
            ...producer.map((conjunct) => readSchemaList(conjunct.prefixItems).length),
        );
        for (let index = 0; index <= tailIndex; index++) {
            if (index >= producerMaxItems) {
                break;
            }
            const inPrefix = index < consumerPrefix.length;
            const element = inPrefix ? consumerPrefix[index] : consumer.items;
            if (!isJsonSchema(element)) {
                continue;
            }
            const failure = this.alternativesFit(
                this.expandAll(producer.map((conjunct) => getElementSchema(conjunct, index))),
                element,
                inPrefix ? `${path}/prefixItems/${index}` : `${path}/items`,
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
    ): ContainmentFailure | undefined {
        if (!getPossibleKinds(producer).has("object")) {
            return undefined;
        }

        // Required members: some producer conjunct must require each one.
        const producerRequired = new Set(
            producer.flatMap((conjunct) => readStringList(conjunct.required)),
        );
        for (const [index, name] of readStringList(consumer.required).entries()) {
            if (!producerRequired.has(name)) {
                return { kind: "mismatch", keyword: "required", path: `${path}/required/${index}` };
            }
        }

        // Member counts: a closed producer can't exceed the members it allows.
        const allowedNames = getClosedMemberNames(producer);
        const producerMinProperties = Math.max(
            getLowerBound(producer, "minProperties"),
            producerRequired.size,
        );
        const producerMaxProperties = Math.min(
            getUpperBound(producer, "maxProperties"),
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
        const consumerProperties = readSchemaRecord(consumer.properties);
        for (const [name, schema] of consumerProperties) {
            if (allowedNames && !allowedNames.has(name)) {
                continue;
            }
            const failure = this.alternativesFit(
                this.expandAll(producer.map((conjunct) => getMemberSchema(conjunct, name))),
                schema,
                `${path}/properties/${escapePointerToken(name)}`,
            );
            if (failure) {
                return failure;
            }
        }

        // Members the consumer doesn't name must satisfy its additionalProperties.
        const additional = consumer.additionalProperties;
        if (!isJsonSchema(additional)) {
            return undefined;
        }
        const additionalPath = `${path}/additionalProperties`;
        const producerNames = allowedNames ?? getDeclaredMemberNames(producer);
        for (const name of producerNames) {
            if (consumerProperties.has(name)) {
                continue;
            }
            const failure = this.alternativesFit(
                this.expandAll(producer.map((conjunct) => getMemberSchema(conjunct, name))),
                additional,
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
            this.expandAll(producer.map((conjunct) => getUnnamedMemberSchema(conjunct))),
            additional,
            additionalPath,
        );
    }

    /** Expands and joins several producer schemas that all apply to the same value. */
    private expandAll(schemas: readonly JsonSchema[]): Alternatives {
        let alternatives: Alternatives = [[]];
        for (const schema of schemas) {
            alternatives = combineAlternatives(alternatives, this.expand(schema), "allOf");
        }
        return alternatives;
    }
}

/** Joins two alternative sets: every pairing of their conjunctions, within the limit. */
function combineAlternatives(
    left: Alternatives,
    right: Alternatives,
    keyword: string,
): Alternatives {
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
