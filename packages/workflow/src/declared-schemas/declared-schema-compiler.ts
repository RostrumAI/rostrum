import Ajv2020, { type ErrorObject, MissingRefError, type ValidateFunction } from "ajv/dist/2020";
import { RE2JS, RE2JSException } from "re2js";
import { escapePointerToken } from "../json-source-map";

/**
 * The JSON Schema 2020-12 compiler for author-declared schemas: workflow
 * input declarations, step output declarations, and the operation
 * catalog's schemas.
 *
 * Publication uses it to report invalid declarations and defaults, and the
 * daemon uses it to build checks for actual values. A check never changes
 * the value it checks: no coercion, defaults, or property removal.
 * References resolve only inside the schema being compiled, and `pattern`
 * runs on a linear-time engine so a small schema and a small input can't
 * block the process through backtracking.
 */

/** A JSON Schema 2020-12 schema: an object of keywords, or `true`/`false`. */
export type JsonSchema = boolean | Readonly<Record<string, unknown>>;

/** True for a value that can be a schema: a JSON object or a boolean. */
export function isJsonSchema(value: unknown): value is JsonSchema {
    return (
        typeof value === "boolean" ||
        (typeof value === "object" && value !== null && !Array.isArray(value))
    );
}

/** One way a value fails a compiled check, located inside the value. */
export interface ValueIssue {
    /** JSON Pointer into the checked value, or `""` for the value itself. */
    path: string;
    /** The schema keyword the value failed, for example `type` or `required`. */
    keyword: string;
    /** A sanitized explanation that names the constraint, never the supplied value. */
    message: string;
}

/** Checks one value against a compiled schema and returns every issue found; empty means valid. */
export type ValueCheck = (value: unknown) => ValueIssue[];

/** The result of compiling a schema: a value check, or why the schema was refused. */
export type SchemaCompilation =
    | {
          /** The schema compiled. */
          ok: true;
          /** Checks values against the schema. */
          check: ValueCheck;
      }
    | {
          /** The schema was refused. */
          ok: false;
          /** JSON Pointer inside the schema to the refused part, or `""` for the whole schema. */
          path: string;
          /** A sanitized explanation of why the schema can't be used. */
          message: string;
      };

/** Compiles author-declared schemas with one configured compiler. */
export interface DeclaredSchemaCompiler {
    /**
     * Compiles a schema into a value check, or refuses it with a located
     * reason. Compiling the same schema object again returns the same
     * result.
     */
    compile(schema: JsonSchema): SchemaCompilation;
}

/** Thrown by the pattern engine when a pattern uses syntax a linear-time engine can't run. */
class UnsupportedPatternError extends Error {
    /** Records which pattern was refused, keeping the engine's own error as the cause. */
    constructor(pattern: string, cause: unknown) {
        super(
            `Pattern '${pattern}' isn't supported: lookaround and backreferences can't run in linear time`,
            {
                cause,
            },
        );
        this.name = "UnsupportedPatternError";
    }
}

/**
 * Compiles `pattern` and `patternProperties` expressions with RE2JS.
 *
 * Ajv caches compiled patterns by `toString()`, so each wrapper returns a
 * pattern-specific string; a shared string would make every pattern
 * check against the first one compiled. `code` names the engine for
 * Ajv's standalone code generation, which this compiler never uses.
 */
const linearTimeRegExp = Object.assign(
    (pattern: string) => {
        let compiled: RE2JS;
        try {
            compiled = RE2JS.compile(pattern);
        } catch (error) {
            if (error instanceof RE2JSException) {
                throw new UnsupportedPatternError(pattern, error);
            }
            throw error;
        }
        return {
            test: (text: string) => compiled.test(text),
            toString: () => `re2js:${pattern}`,
        };
    },
    { code: "re2js" },
);

/**
 * Creates a compiler for author-declared schemas.
 *
 * Create one per validation run or prepared publication: the compiler
 * keeps every schema it has compiled, so a process-wide instance would
 * grow with each document it sees. Value checks report every issue.
 */
export function createDeclaredSchemaCompiler(): DeclaredSchemaCompiler {
    // Standard JSON Schema only: strict about unknown keywords, relaxed
    // about loosely typed schemas, `format` as an annotation, and no
    // cross-schema registry that two workflows could collide in.
    const ajv = new Ajv2020({
        strictSchema: true,
        strictTypes: false,
        strictTuples: false,
        strictRequired: false,
        validateSchema: true,
        validateFormats: false,
        addUsedSchema: false,
        allErrors: true,
        logger: false,
        code: { regExp: linearTimeRegExp },
    });
    const compilations = new Map<JsonSchema, SchemaCompilation>();

    return {
        compile(schema) {
            const cached = compilations.get(schema);
            if (cached) {
                return cached;
            }
            const compilation = compileSchema(ajv, schema);
            compilations.set(schema, compilation);
            return compilation;
        },
    };
}

/** Validates, compiles, and wraps one schema, turning every refusal into a located reason. */
function compileSchema(ajv: Ajv2020, schema: JsonSchema): SchemaCompilation {
    // An asynchronous schema would return a promise instead of a verdict.
    if (typeof schema === "object" && Object.hasOwn(schema, "$async")) {
        return { ok: false, path: "/$async", message: "Asynchronous schemas aren't supported" };
    }

    // Check the declaration against the 2020-12 meta-schema first, so a
    // malformed keyword is reported where it sits.
    if (!ajv.validateSchema(schema)) {
        const first = ajv.errors?.[0];
        return {
            ok: false,
            path: first ? locateIssue(first) : "",
            message: first
                ? `The schema is invalid: '${first.keyword}' ${first.message ?? "is not satisfied"}`
                : "The schema is invalid",
        };
    }

    let validate: ValidateFunction;
    try {
        validate = ajv.compile(schema);
    } catch (error) {
        return { ok: false, path: "", message: describeCompileError(error) };
    }
    return { ok: true, check: (value) => checkValue(validate, value) };
}

/** Runs a compiled validator and maps its errors to located issues. */
function checkValue(validate: ValidateFunction, value: unknown): ValueIssue[] {
    if (validate(value)) {
        return [];
    }
    return (validate.errors ?? []).map((error) => ({
        path: locateIssue(error),
        keyword: error.keyword,
        message: `Value ${error.message ?? "doesn't satisfy the schema"}`,
    }));
}

/**
 * Locates an Ajv error inside the checked value. An unexpected member is
 * located at the member itself; a missing member can only be located at
 * the object that lacks it.
 */
function locateIssue(error: ErrorObject): string {
    const additional = error.params.additionalProperty;
    if (error.keyword === "additionalProperties" && typeof additional === "string") {
        return `${error.instancePath}/${escapePointerToken(additional)}`;
    }
    return error.instancePath;
}

/**
 * Explains why Ajv refused to compile a schema that passed the
 * meta-schema, without repeating the underlying exception.
 */
function describeCompileError(error: unknown): string {
    if (error instanceof UnsupportedPatternError) {
        return error.message;
    }
    if (error instanceof MissingRefError) {
        return `The reference '${error.missingRef}' can't be resolved inside this schema`;
    }
    if (error instanceof Error && error.message.startsWith("strict mode:")) {
        return `The schema uses a keyword JSON Schema 2020-12 doesn't define (${error.message})`;
    }
    return "The schema can't be compiled";
}
