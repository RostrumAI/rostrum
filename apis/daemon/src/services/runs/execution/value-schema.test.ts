import { describe, expect, test } from "bun:test";
import {
    type ValueCheckResult,
    type ValueSchemaCompileResult,
    ValueSchemaCompiler,
} from "./value-schema";

/** The compiler is stateless once constructed, so one instance serves every case. */
const compiler = new ValueSchemaCompiler();

/** Compiles a fragment that the test has already proven is preparable. */
function compileChecked(fragment: unknown, target: ValueSchemaCompiler = compiler) {
    const result = target.compile(fragment);
    if (!result.ok) {
        throw new Error(`Expected the fragment to prepare but it failed: ${result.code}`);
    }
    return result.check;
}

/** Compiles a fragment that the test expects to be refused. */
function expectRefused(
    fragment: unknown,
    target: ValueSchemaCompiler = compiler,
): Extract<ValueSchemaCompileResult, { ok: false }> {
    const result = target.compile(fragment);
    if (result.ok) {
        throw new Error("Expected the fragment to be refused");
    }
    return result;
}

/** Fails the test unless a value was rejected, and narrows to the rejection. */
function expectRejected(result: ValueCheckResult): Extract<ValueCheckResult, { ok: false }> {
    if (result.ok) {
        throw new Error("Expected the value to be rejected");
    }
    return result;
}

/** Nests objects `depth` levels deep, counting the root container as level one. */
function nestedValue(depth: number): unknown {
    let value: unknown = {};
    for (let level = 1; level < depth; level += 1) {
        value = { child: value };
    }
    return value;
}

/** Nests a schema `levels` levels deep; each level adds two JSON containers. */
function nestedSchema(levels: number): unknown {
    let schema: unknown = { type: "integer" };
    for (let level = 0; level < levels; level += 1) {
        schema = { type: "object", properties: { child: schema } };
    }
    return schema;
}

describe("value schema preparation", () => {
    test("enforces a fragment's declared constraints on values", () => {
        const check = compileChecked({
            type: "object",
            properties: { name: { type: "string", minLength: 2 } },
            required: ["name"],
            additionalProperties: false,
        });

        // The prepared schema accepts a satisfying value and locates each rejection.
        expect(check.validate({ name: "Ada" }).ok).toBe(true);
        expect(expectRejected(check.validate({ name: "A" })).path).toBe("/name");
        expect(expectRejected(check.validate({})).path).toBe("/name");
        expect(expectRejected(check.validate({ name: "Ada", extra: 1 })).path).toBe("/extra");
    });

    test("treats format as an annotation while still enforcing sibling keywords", () => {
        const check = compileChecked({ type: "string", format: "date-time", minLength: 5 });

        // A value that is not a date-time is accepted, because this release never
        // rejects on format, while the schema's other constraints still apply.
        expect(check.validate("not-a-timestamp").ok).toBe(true);
        expect(expectRejected(check.validate("abc")).path).toBe("");
    });

    test("preserves format inside literal data rather than treating it as an annotation", () => {
        const check = compileChecked({
            type: "object",
            properties: { shape: { const: { format: "date-time" } } },
            required: ["shape"],
            additionalProperties: false,
        });

        // `format` inside `const` is data: the literal value must satisfy the schema.
        expect(check.validate({ shape: { format: "date-time" } }).ok).toBe(true);
        expect(expectRejected(check.validate({ shape: {} })).path).toBe("/shape");
    });

    test("does not fill a missing member from a schema default", () => {
        const check = compileChecked({
            type: "object",
            properties: { mode: { type: "string", default: "auto" } },
            additionalProperties: false,
        });
        const value = {};

        // Validation neither supplies the default nor rewrites the checked value.
        expect(check.validate(value).ok).toBe(true);
        expect(value).toEqual({});
    });

    test("refuses a fragment that is not a JSON Schema 2020-12 schema", () => {
        // An unknown dialect, a misused keyword, a non-schema value, and a
        // schema keyword this release does not evaluate are each refused.
        expect(expectRefused({ $schema: "http://json-schema.org/draft-07/schema#" }).code).toBe(
            "unsupported_schema",
        );
        expect(expectRefused({ type: 5 }).code).toBe("invalid_schema");
        expect(expectRefused(null).code).toBe("invalid_schema");
        expect(expectRefused({ $id: "https://example.com/schema", type: "string" }).code).toBe(
            "unsupported_schema",
        );
        expect(expectRefused({ $dynamicRef: "#node" }).code).toBe("unsupported_schema");
    });

    test("refuses references that leave the fragment, resolve nowhere, or recurse", () => {
        // A remote reference and a pointer that names no location are both refused.
        expect(expectRefused({ $ref: "https://example.com/schema.json#/$defs/Name" }).code).toBe(
            "unsupported_schema",
        );
        expect(expectRefused({ $ref: "#/$defs/Missing" }).code).toBe("invalid_schema");

        // A schema that references itself is refused: the compiler cannot evaluate it safely.
        const recursive = expectRefused({
            $defs: {
                Node: {
                    type: "object",
                    properties: { next: { $ref: "#/$defs/Node" } },
                },
            },
            $ref: "#/$defs/Node",
        });
        expect(recursive.code).toBe("unsupported_schema");
        expect(recursive.path).toBe("/$defs/Node/properties/next/$ref");
    });

    test("resolves a reference that points at a declared subschema", () => {
        const check = compileChecked({
            $defs: { Name: { type: "string", minLength: 2 } },
            type: "object",
            properties: { name: { $ref: "#/$defs/Name" } },
            required: ["name"],
            additionalProperties: false,
        });

        // A preparable fragment keeps its reference and still enforces the target.
        expect(check.validate({ name: "Ada" }).ok).toBe(true);
        expect(expectRejected(check.validate({ name: "A" })).path).toBe("/name");
    });

    test("bounds the depth of a fragment and of a checked value", () => {
        const atLimit = new ValueSchemaCompiler(5);
        const permissive = compileChecked({ type: "object" }, atLimit);

        // A fragment at the bound prepares and one level deeper is refused.
        expect(atLimit.compile(nestedSchema(2)).ok).toBe(true);
        expect(expectRefused(nestedSchema(3), atLimit).code).toBe("value_depth");
        // The root counts as level one for a checked value too.
        expect(permissive.validate(nestedValue(5)).ok).toBe(true);
        expect(expectRejected(permissive.validate(nestedValue(6))).code).toBe("value_depth");
    });

    test("refuses a reference that does not name a schema position", () => {
        // A target must be an object or boolean schema, and an array index is
        // written without a leading zero.
        expect(expectRefused({ $ref: "#/$defs/x", $defs: { x: "text" } }).code).toBe(
            "invalid_schema",
        );
        expect(
            expectRefused({
                type: "object",
                properties: { a: { $ref: "#/prefixItems/01" } },
                prefixItems: [{ type: "integer" }, { type: "string" }],
            }).code,
        ).toBe("invalid_schema");
    });

    test("never throws at the caller that supplied an unreadable value or fragment", () => {
        // An object whose own members cannot be inspected is refused as a
        // fragment and as a value, rather than escaping as an exception.
        const unreadable = new Proxy(
            {},
            {
                getPrototypeOf: () => {
                    throw new Error("unreadable");
                },
            },
        );
        expect(compiler.compile(unreadable)).toMatchObject({
            ok: false,
            code: "invalid_schema",
        });
        const check = compileChecked({ type: "object" });
        expect(expectRejected(check.validate({ value: unreadable })).code).toBe("invalid_json");
    });

    test("rejects values JSON cannot represent", () => {
        const check = compileChecked({ type: "object" });

        // A cycle, a non-finite number, and an exotic object are refused as JSON,
        // never accepted because the schema did not mention them.
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(expectRejected(check.validate(cyclic)).code).toBe("invalid_json");
        expect(expectRejected(check.validate({ value: Number.POSITIVE_INFINITY })).code).toBe(
            "invalid_json",
        );
        expect(expectRejected(check.validate({ value: new Date() })).code).toBe("invalid_json");
        expect(expectRejected(check.validate({ value: undefined })).code).toBe("invalid_json");
    });
});
