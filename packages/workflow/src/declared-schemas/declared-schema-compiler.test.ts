import { describe, expect, test } from "bun:test";
import {
    createDeclaredSchemaCompiler,
    isJsonSchema,
    type JsonSchema,
    type ValueIssue,
} from "./declared-schema-compiler";

/** Compiles a schema with a fresh compiler and fails the test when it's refused. */
function checkerFor(schema: JsonSchema): (value: unknown) => ValueIssue[] {
    const compilation = createDeclaredSchemaCompiler().compile(schema);
    if (!compilation.ok) {
        throw new Error(`Expected the schema to compile: ${compilation.message}`);
    }
    return compilation.check;
}

/** Compiles a schema with a fresh compiler and returns its refusal's path and message. */
function refusalOf(schema: JsonSchema) {
    const compilation = createDeclaredSchemaCompiler().compile(schema);
    return compilation.ok ? undefined : { path: compilation.path, message: compilation.message };
}

describe("isJsonSchema", () => {
    // Proves only objects and booleans are treated as schemas.
    test("accepts objects and booleans only", () => {
        expect([{}, true, false].map(isJsonSchema)).toEqual([true, true, true]);
        expect([null, [], "number", 1].map(isJsonSchema)).toEqual([false, false, false, false]);
    });
});

describe("refused schemas", () => {
    // Proves a malformed keyword is located at the keyword inside the schema.
    test("a keyword with the wrong type is located", () => {
        expect(refusalOf({ type: "number", minimum: "zero" })?.path).toBe("/minimum");
    });

    // Proves a keyword JSON Schema 2020-12 doesn't define is refused rather than ignored.
    test("an unknown keyword is refused", () => {
        expect(refusalOf({ type: "number", colour: "red" })?.message).toContain("doesn't define");
    });

    // Proves an asynchronous schema is refused, since it would yield a promise, not a verdict.
    test("an asynchronous schema is refused", () => {
        expect(refusalOf({ $async: true, type: "number" })?.path).toBe("/$async");
    });

    // Proves references can't reach outside the schema being compiled.
    test("an external reference is refused", () => {
        expect(refusalOf({ $ref: "https://example.com/x.json" })?.message).toBe(
            "The reference 'https://example.com/x.json' can't be resolved inside this schema",
        );
    });

    // Proves patterns that need backtracking are refused, so no input can stall the process.
    test("lookaround and backreferences are refused", () => {
        for (const pattern of ["(?<=a)b", "(a)\\1"]) {
            expect(refusalOf({ type: "string", pattern })?.message).toContain("linear time");
        }
    });
});

describe("value checks", () => {
    // Proves a value is checked as given: no coercion of a numeric string to a number.
    test("does not coerce", () => {
        const check = checkerFor({ type: "number" });
        expect(check(1)).toEqual([]);
        expect(check("1").map((issue) => issue.keyword)).toEqual(["type"]);
    });

    // Proves every issue is reported, each located where an author can find it.
    test("reports every issue at its location", () => {
        const check = checkerFor({
            type: "object",
            properties: { a: { type: "number" } },
            required: ["a", "b"],
            additionalProperties: false,
        });

        // A missing member is located at its object; an extra member at itself, pointer-escaped.
        expect(check({ a: "1", "x/y": 1 }).map((issue) => [issue.keyword, issue.path])).toEqual([
            ["required", ""],
            ["additionalProperties", "/x~1y"],
            ["type", "/a"],
        ]);
    });

    // Proves a check leaves the checked value unchanged: no defaults or removed members.
    test("does not change the value", () => {
        const check = checkerFor({
            type: "object",
            properties: { a: { type: "number", default: 1 } },
            additionalProperties: false,
        });
        const value = { extra: true };
        check(value);
        expect(value).toEqual({ extra: true });
    });

    // Proves `format` is an annotation, so it never rejects a value.
    test("format is not enforced", () => {
        expect(checkerFor({ type: "string", format: "email" })("not an email")).toEqual([]);
    });

    // Proves the boolean schemas accept everything and nothing.
    test("boolean schemas", () => {
        expect(checkerFor(true)(1)).toEqual([]);
        expect(checkerFor(false)(1)).toHaveLength(1);
    });

    // Proves local references resolve, including a recursive one to the schema's own root.
    test("local references resolve", () => {
        const defined = checkerFor({ $defs: { n: { type: "number" } }, $ref: "#/$defs/n" });
        expect(defined(1)).toEqual([]);
        expect(defined("a")).toHaveLength(1);

        // A nested array of numbers matches the recursive schema; a nested string doesn't.
        const tree = checkerFor({
            anyOf: [{ type: "number" }, { type: "array", items: { $ref: "#" } }],
        });
        expect(tree([1, [2, [3]]])).toEqual([]);
        expect(tree([1, ["x"]]).length).toBeGreaterThan(0);
    });

    // Proves a schema carrying its own valid `$id` compiles and checks values.
    test("a schema with its own identifier", () => {
        expect(checkerFor({ $id: "urn:example:amount", type: "number" })("a")).toHaveLength(1);
    });
});

describe("compiler state", () => {
    // Proves compiling the same schema object again reuses the first result.
    test("the same schema object compiles once", () => {
        const compiler = createDeclaredSchemaCompiler();
        const schema = { type: "number" };
        expect(compiler.compile(schema)).toBe(compiler.compile(schema));
    });

    // Proves distinct patterns in one compiler don't share a compiled expression.
    test("each pattern checks against itself", () => {
        const compiler = createDeclaredSchemaCompiler();
        const onlyA = compiler.compile({ type: "string", pattern: "^a+$" });
        const onlyB = compiler.compile({ type: "string", pattern: "^b+$" });

        // Compile both first, then check, so a shared cache entry would misjudge one of them.
        expect(onlyA.ok && onlyA.check("bbb")).toHaveLength(1);
        expect(onlyB.ok && onlyB.check("bbb")).toEqual([]);
    });

    // Proves two schemas that share an identifier don't collide in one compiler.
    test("schemas with the same identifier stay separate", () => {
        const compiler = createDeclaredSchemaCompiler();
        const numbers = compiler.compile({ $id: "urn:example:value", type: "number" });
        const strings = compiler.compile({ $id: "urn:example:value", type: "string" });
        expect(numbers.ok && numbers.check(1)).toEqual([]);
        expect(strings.ok && strings.check("a")).toEqual([]);
    });
});
