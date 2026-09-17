import { escapePointerToken } from "@rostrum/workflow";
import type { JsonObject, JsonValue } from "@rostrum/workflow/execution";
import Ajv2020 from "ajv/dist/2020";
import type { TSchema } from "typebox";
import { Compile, type Validator } from "typebox/compile";
import type { TLocalizedValidationError } from "typebox/error";
import { checkJsonValue, type JsonValueCheckResult, MAX_VALUE_DEPTH } from "./json-value";

/**
 * Compiles the value schemas a workflow declares, without executing work.
 *
 * A workflow's `inputs` and step `outputs` are JSON Schema 2020-12
 * fragments. Preparation validates each fragment against the offline
 * 2020-12 meta-schema, rejects schema features this release does not
 * evaluate, and compiles the fragment once so execution can check a value
 * without re-reading its schema.
 *
 * Two rules shape compilation:
 *
 * - `format` is an annotation. This release never rejects a value because of
 *   its format, so the `format` keyword is removed from the schema positions
 *   of the compiled copy. The published document is never modified, and
 *   `format` inside `const`, `enum`, `default`, or `examples` is data, not an
 *   annotation, so it stays.
 * - Schema defaults never fill a missing value. Compilation only checks
 *   values; it never converts, cleans, or creates one.
 */

/** Why a declared value schema could not be prepared. */
export type ValueSchemaFailureCode = "invalid_schema" | "unsupported_schema" | "value_depth";

/** Why a value was rejected. */
export type ValueCheckFailureCode =
    | "invalid_value"
    | "invalid_json"
    | "value_depth"
    | "schema_evaluation";

/** The outcome of preparing one declared value schema. */
export type ValueSchemaCompileResult =
    | { readonly ok: true; readonly check: CompiledValueCheck }
    | { readonly ok: false; readonly code: ValueSchemaFailureCode; readonly path: string };

/** The outcome of checking one value against a prepared schema. */
export type ValueCheckResult =
    | { readonly ok: true }
    | { readonly ok: false; readonly code: ValueCheckFailureCode; readonly path: string };

/**
 * The dialect a fragment may declare.
 *
 * The workflow format stores a schema fragment, not a schema resource, so a
 * fragment either declares exactly this dialect or declares none: the
 * selected release always evaluates 2020-12.
 */
const SUPPORTED_DIALECT = "https://json-schema.org/draft/2020-12/schema";

/**
 * Schema keywords this release rejects rather than accepts with a different
 * meaning.
 *
 * `$id` would turn a fragment into a named schema resource and change how a
 * reference resolves; the dynamic-scope keywords resolve by the evaluation
 * scope rather than by the document, which this compiler does not implement.
 */
const UNSUPPORTED_KEYWORDS: readonly string[] = [
    "$id",
    "$dynamicAnchor",
    "$dynamicRef",
    "$recursiveAnchor",
    "$recursiveRef",
];

/** Keywords whose value is one subschema. */
const SINGLE_SCHEMA_KEYWORDS: readonly string[] = [
    "additionalProperties",
    "propertyNames",
    "items",
    "contains",
    "not",
    "if",
    "then",
    "else",
    "unevaluatedProperties",
    "unevaluatedItems",
];

/** Keywords whose value is an array of subschemas. */
const SCHEMA_ARRAY_KEYWORDS: readonly string[] = ["allOf", "anyOf", "oneOf", "prefixItems"];

/** Keywords whose value maps names to subschemas. */
const SCHEMA_MAP_KEYWORDS: readonly string[] = [
    "properties",
    "patternProperties",
    "dependentSchemas",
    "dependencies",
    "$defs",
    "definitions",
];

/** One `$ref` occurrence with the pointer of the schema that holds it. */
interface RefSite {
    /** JSON Pointer of the schema object that declares the reference. */
    readonly pointer: string;
    /** The declared reference value. */
    readonly ref: string;
}

/** A schema fragment that cannot be prepared, carrying why and where. */
class SchemaPreparationError extends Error {
    readonly code: ValueSchemaFailureCode;
    readonly path: string;

    /** Records the failure an author or operator has to act on. */
    constructor(code: ValueSchemaFailureCode, path: string) {
        super(`Schema preparation failed: ${code} at ${path}`);
        this.code = code;
        this.path = path;
    }
}

/** A prepared schema and the check that evaluates values against it. */
export class CompiledValueCheck {
    private readonly compiled: Validator;
    private readonly maxValueDepth: number;

    /**
     * Wraps a compiled schema. Construct through
     * {@link ValueSchemaCompiler.compile}, which prepares the schema first.
     */
    constructor(compiled: Validator, maxValueDepth: number) {
        this.compiled = compiled;
        this.maxValueDepth = maxValueDepth;
    }

    /**
     * Checks one value against the schema.
     *
     * The value is first checked as JSON within the configured depth, so a
     * handler cannot smuggle a cycle, a non-finite number, or an exotic
     * object into stored run state.
     */
    validate(value: unknown): ValueCheckResult {
        let inspected: JsonValueCheckResult;
        try {
            inspected = checkJsonValue(value, this.maxValueDepth);
        } catch {
            // A value whose own members cannot be read is not JSON, and a
            // check never throws at the call site that supplied it.
            return { ok: false, code: "invalid_json", path: "" };
        }
        if (!inspected.ok) {
            return { ok: false, code: inspected.code, path: inspected.path };
        }

        try {
            if (this.compiled.Check(inspected.value)) {
                return { ok: true };
            }
            const [error] = this.compiled.Errors(inspected.value);
            return { ok: false, code: "invalid_value", path: failurePath(error) };
        } catch {
            // An evaluation failure is never an accepted value; the exception
            // text stays out of the result a caller or inspection can read.
            return { ok: false, code: "schema_evaluation", path: "" };
        }
    }
}

/**
 * Locates one failing value.
 *
 * A missing or undeclared member is reported at the member itself rather than
 * at the object that carries it, so an author sees which member the schema
 * refused.
 */
function failurePath(error: TLocalizedValidationError | undefined): string {
    if (!error) {
        return "";
    }
    if (error.keyword === "required") {
        const [member] = error.params.requiredProperties;
        if (member !== undefined) {
            return `${error.instancePath}/${escapePointerToken(member)}`;
        }
    }
    if (error.keyword === "additionalProperties") {
        const [member] = error.params.additionalProperties;
        if (member !== undefined) {
            return `${error.instancePath}/${escapePointerToken(member)}`;
        }
    }
    return error.instancePath;
}

/** Prepares the value schemas one publication declares. */
export class ValueSchemaCompiler {
    private readonly maxValueDepth: number;
    private readonly fragmentValidator: Ajv2020;

    /**
     * Creates a compiler for fragments up to `maxValueDepth` container levels.
     *
     * The meta-schema validator is offline: it uses the 2020-12 resources
     * bundled with the validation library and never fetches a remote schema.
     */
    constructor(maxValueDepth: number = MAX_VALUE_DEPTH) {
        this.maxValueDepth = maxValueDepth;
        this.fragmentValidator = new Ajv2020({
            strict: false,
            validateFormats: false,
            allErrors: false,
        });
    }

    /**
     * Prepares one declared fragment.
     *
     * A successful result carries a check that can be reused for every value
     * the fragment describes, including across runs.
     */
    compile(schema: unknown): ValueSchemaCompileResult {
        let inspected: JsonValueCheckResult;
        try {
            inspected = checkJsonValue(schema, this.maxValueDepth);
        } catch {
            // A fragment whose own members cannot be read is not a schema, and
            // preparation never throws at the caller that supplied it.
            return { ok: false, code: "invalid_schema", path: "" };
        }
        if (!inspected.ok) {
            return {
                ok: false,
                code: inspected.code === "value_depth" ? "value_depth" : "invalid_schema",
                path: inspected.path,
            };
        }

        try {
            const refs: RefSite[] = [];
            const adjusted = this.adjustSchema(inspected.value, "", true, refs);
            this.checkReferences(inspected.value, refs);
            if (!this.fragmentValidator.validateSchema(adjusted)) {
                const [error] = this.fragmentValidator.errors ?? [];
                return { ok: false, code: "invalid_schema", path: error?.instancePath ?? "" };
            }
            // The adjusted fragment is a JSON Schema object by construction,
            // and the check above proved it satisfies the 2020-12
            // meta-schema; `TSchema` is the compiler's structural marker.
            const compiled = Compile(adjusted as TSchema);
            return { ok: true, check: new CompiledValueCheck(compiled, this.maxValueDepth) };
        } catch (error) {
            if (error instanceof SchemaPreparationError) {
                return { ok: false, code: error.code, path: error.path };
            }
            // A compiler failure means this release cannot evaluate the
            // fragment.
            return { ok: false, code: "invalid_schema", path: "" };
        }
    }

    /**
     * Copies one schema, rejecting features this release does not evaluate
     * and dropping `format` annotations from schema positions.
     *
     * Only schema positions are visited: a value under `const`, `enum`,
     * `default`, or `examples` is literal data and is copied unchanged.
     */
    private adjustSchema(
        schema: JsonValue,
        path: string,
        isRoot: boolean,
        refs: RefSite[],
    ): JsonObject | boolean {
        if (typeof schema === "boolean") {
            return schema;
        }
        if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
            throw new SchemaPreparationError("invalid_schema", path);
        }

        const adjusted: Record<string, JsonValue> = {};
        for (const [keyword, value] of Object.entries(schema)) {
            if (keyword === "format") {
                continue;
            }
            if (keyword === "$schema") {
                if (!isRoot || value !== SUPPORTED_DIALECT) {
                    throw new SchemaPreparationError("unsupported_schema", member(path, keyword));
                }
                adjusted[keyword] = value;
                continue;
            }
            if (UNSUPPORTED_KEYWORDS.includes(keyword)) {
                throw new SchemaPreparationError("unsupported_schema", member(path, keyword));
            }
            if (keyword === "$ref") {
                if (typeof value !== "string") {
                    throw new SchemaPreparationError("invalid_schema", member(path, keyword));
                }
                refs.push({ pointer: path, ref: value });
                adjusted[keyword] = value;
                continue;
            }
            adjusted[keyword] = this.adjustKeywordValue(keyword, value, path, refs);
        }
        return adjusted;
    }

    /**
     * Copies one keyword's value, descending only into the subschema
     * positions that keyword defines.
     */
    private adjustKeywordValue(
        keyword: string,
        value: JsonValue,
        path: string,
        refs: RefSite[],
    ): JsonValue {
        if (SINGLE_SCHEMA_KEYWORDS.includes(keyword)) {
            // `items` also accepts the array form of a tuple schema.
            if (Array.isArray(value) && keyword === "items") {
                return value.map((element, index) =>
                    this.adjustSchema(element, `${member(path, keyword)}/${index}`, false, refs),
                );
            }
            return this.adjustSchema(value, member(path, keyword), false, refs);
        }
        if (SCHEMA_ARRAY_KEYWORDS.includes(keyword)) {
            if (!Array.isArray(value)) {
                throw new SchemaPreparationError("invalid_schema", member(path, keyword));
            }
            return value.map((element, index) =>
                this.adjustSchema(element, `${member(path, keyword)}/${index}`, false, refs),
            );
        }
        if (SCHEMA_MAP_KEYWORDS.includes(keyword)) {
            return this.adjustSchemaMap(keyword, value, path, refs);
        }
        return value;
    }

    /**
     * Copies a keyword whose value maps names to subschemas.
     *
     * `dependencies` also accepts an array of required property names, which
     * is data rather than a subschema and is copied unchanged.
     */
    private adjustSchemaMap(
        keyword: string,
        value: JsonValue,
        path: string,
        refs: RefSite[],
    ): JsonValue {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            throw new SchemaPreparationError("invalid_schema", member(path, keyword));
        }
        const adjusted: Record<string, JsonValue> = {};
        for (const [name, memberSchema] of Object.entries(value)) {
            const memberPath = `${member(path, keyword)}/${escapePointerToken(name)}`;
            adjusted[name] = Array.isArray(memberSchema)
                ? memberSchema
                : this.adjustSchema(memberSchema, memberPath, false, refs);
        }
        return adjusted;
    }

    /**
     * Rejects references that leave the fragment, references to a location
     * the fragment does not define, and reference cycles.
     *
     * A cycle makes the schema recursive. The compiler this release uses
     * cannot evaluate every recursive schema safely — a plain self-reference
     * exhausts the stack while compiling — so preparation refuses the
     * fragment instead of risking a stack overflow while checking a value.
     */
    private checkReferences(root: JsonValue, refs: readonly RefSite[]): void {
        const targets = new Map<string, string>();
        for (const site of refs) {
            if (!site.ref.startsWith("#")) {
                throw new SchemaPreparationError(
                    "unsupported_schema",
                    member(site.pointer, "$ref"),
                );
            }
            const target = resolvePointer(root, site.ref.slice(1));
            if (target === undefined) {
                throw new SchemaPreparationError("invalid_schema", member(site.pointer, "$ref"));
            }
            targets.set(site.pointer, target);
        }

        // A reference site reaches every reference declared inside its target,
        // so a site that reaches itself declares a recursive schema.
        const settled = new Set<string>();
        const onPath = new Set<string>();
        const reachesCycle = (pointer: string): boolean => {
            if (onPath.has(pointer)) {
                return true;
            }
            if (settled.has(pointer)) {
                return false;
            }
            const target = targets.get(pointer);
            if (target === undefined) {
                return false;
            }
            onPath.add(pointer);
            for (const candidate of targets.keys()) {
                const insideTarget =
                    target === "" || candidate === target || candidate.startsWith(`${target}/`);
                if (insideTarget && reachesCycle(candidate)) {
                    return true;
                }
            }
            onPath.delete(pointer);
            settled.add(pointer);
            return false;
        };

        for (const site of refs) {
            if (reachesCycle(site.pointer)) {
                throw new SchemaPreparationError(
                    "unsupported_schema",
                    member(site.pointer, "$ref"),
                );
            }
        }
    }
}

/** Appends one member name to a JSON Pointer. */
function member(path: string, name: string): string {
    return `${path}/${escapePointerToken(name)}`;
}

/** Resolves a local JSON Pointer against the fragment, or undefined when it does not resolve. */
function resolvePointer(root: JsonValue, pointer: string): string | undefined {
    if (pointer === "") {
        return "";
    }
    if (!pointer.startsWith("/")) {
        return undefined;
    }

    let current: JsonValue = root;
    let currentPointer = "";
    for (const token of pointer.slice(1).split("/").map(unescapePointerToken)) {
        if (Array.isArray(current)) {
            // RFC 6901 indexes an array with `0` or a digit run with no leading zero.
            const index = /^(?:0|[1-9][0-9]*)$/.test(token) ? Number(token) : undefined;
            const element = index !== undefined ? current[index] : undefined;
            if (element === undefined) {
                return undefined;
            }
            current = element;
            currentPointer = `${currentPointer}/${index}`;
            continue;
        }
        if (!isJsonObject(current) || !Object.hasOwn(current, token)) {
            return undefined;
        }
        // The fragment came from parsed JSON, so every own member is a JSON
        // value; the assertion states that guarantee for the index signature.
        current = current[token] as JsonValue;
        currentPointer = member(currentPointer, token);
    }
    return currentPointer;
}

/** True for a JSON object: an object that is not an array or null. */
function isJsonObject(value: JsonValue): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reverses JSON Pointer escaping for one reference token. */
function unescapePointerToken(token: string): string {
    return token.replaceAll("~1", "/").replaceAll("~0", "~");
}
