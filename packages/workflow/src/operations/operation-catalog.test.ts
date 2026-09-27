/**
 * @fileoverview Tests the invariants every catalog declaration must hold.
 * Publication validation and daemon preparation both read the catalog, so
 * a mis-keyed operation, an uncompilable schema, an invalid default, or an
 * open output schema would break both.
 *
 * OPERATION_CATALOG:
 * - keys every operation by its own name: the catalog holds exactly `add`,
 *   `divide`, and `greet`, each under its declaration's `name`.
 * - every schema compiles: each configuration, output, and argument schema
 *   compiles with the declared-schema compiler.
 * - every default is valid: each argument default passes its own schema.
 * - every output schema is closed and fully required: each output schema
 *   sets `additionalProperties: false` and requires all its properties.
 *
 * toJsonSchema:
 * - views a TypeBox schema as plain JSON Schema: it returns the same object,
 *   which serializes to only the JSON Schema keywords.
 */

import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import { createDeclaredSchemaCompiler } from "../declared-schemas/declared-schema-compiler";
import { OPERATION_CATALOG, toJsonSchema } from "./operation-catalog";

describe("OPERATION_CATALOG", () => {
    // Proves each declaration is reachable under the name a task's configuration selects.
    test("keys every operation by its own name", () => {
        expect([...OPERATION_CATALOG.keys()].sort()).toEqual(["add", "divide", "greet"]);
        for (const [name, operation] of OPERATION_CATALOG) {
            expect(operation.name).toBe(name);
        }
    });

    // Proves every catalog schema compiles, so publication never meets a broken catalog schema.
    test("every schema compiles", () => {
        const compiler = createDeclaredSchemaCompiler();
        for (const operation of OPERATION_CATALOG.values()) {
            const schemas = [
                operation.configSchema,
                operation.outputSchema,
                ...Object.values(operation.arguments).map((argument) => argument.schema),
            ];
            for (const schema of schemas) {
                expect({
                    operation: operation.name,
                    ok: compiler.compile(toJsonSchema(schema)).ok,
                }).toEqual({ operation: operation.name, ok: true });
            }
        }
    });

    // Proves every argument default satisfies its own schema.
    test("every default is valid", () => {
        const compiler = createDeclaredSchemaCompiler();
        for (const operation of OPERATION_CATALOG.values()) {
            for (const [name, argument] of Object.entries(operation.arguments)) {
                if (!Object.hasOwn(argument, "default")) {
                    continue;
                }
                const compiled = compiler.compile(toJsonSchema(argument.schema));
                expect({
                    argument: `${operation.name}.${name}`,
                    issues: compiled.ok ? compiled.check(argument.default) : "refused",
                }).toEqual({ argument: `${operation.name}.${name}`, issues: [] });
            }
        }
    });

    // Proves every output is closed and fully required, so steps can bind to any declared member.
    test("every output schema is closed and fully required", () => {
        for (const operation of OPERATION_CATALOG.values()) {
            const schema = operation.outputSchema;
            const json = toJsonSchema(schema);
            expect({
                operation: operation.name,
                closed: typeof json === "object" && json.additionalProperties === false,
                required: [...(schema.required ?? [])].sort(),
            }).toEqual({
                operation: operation.name,
                closed: true,
                required: Object.keys(schema.properties).sort(),
            });
        }
    });
});

describe("toJsonSchema", () => {
    // Proves the JSON Schema view is the TypeBox schema itself, with the same serialized keywords.
    test("views a TypeBox schema as plain JSON Schema", () => {
        const schema = Type.Number({ minimum: 0 });
        expect<unknown>(toJsonSchema(schema)).toBe(schema);
        expect(JSON.parse(JSON.stringify(toJsonSchema(schema)))).toEqual({
            type: "number",
            minimum: 0,
        });
    });
});
