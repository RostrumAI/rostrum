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
 * - every configuration schema accepts only an empty object: `{}` passes
 *   and an unknown member fails `additionalProperties`.
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
        // Checks the catalog holds exactly the three shipped operations.
        expect([...OPERATION_CATALOG.keys()].sort()).toEqual(["add", "divide", "greet"]);

        // Checks each entry's key matches its declaration's own name.
        for (const [name, operation] of OPERATION_CATALOG) {
            expect(operation.name).toBe(name);
        }
    });

    // Proves every catalog schema compiles, so publication never meets a broken catalog schema.
    test("every schema compiles", () => {
        // Uses the same compiler publication applies to declared schemas.
        const compiler = createDeclaredSchemaCompiler();
        for (const operation of OPERATION_CATALOG.values()) {
            // Gathers the configuration, output, and argument schemas of one operation.
            const schemas = [
                operation.configSchema,
                operation.outputSchema,
                ...Object.values(operation.arguments).map((argument) => argument.schema),
            ];

            // Checks each schema compiles, naming the operation on failure.
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
        // Uses the same compiler publication applies to declared schemas.
        const compiler = createDeclaredSchemaCompiler();
        for (const operation of OPERATION_CATALOG.values()) {
            for (const [name, argument] of Object.entries(operation.arguments)) {
                // Skips arguments that declare no default.
                if (!Object.hasOwn(argument, "default")) {
                    continue;
                }

                // Checks the default produces no issues against its argument's schema.
                const compiled = compiler.compile(toJsonSchema(argument.schema));
                expect({
                    argument: `${operation.name}.${name}`,
                    issues: compiled.ok ? compiled.check(argument.default) : "refused",
                }).toEqual({ argument: `${operation.name}.${name}`, issues: [] });
            }
        }
    });

    // Proves no operation takes configuration, so a task naming an unknown option is refused.
    test("every configuration schema accepts only an empty object", () => {
        // Uses the same compiler publication applies to declared schemas.
        const compiler = createDeclaredSchemaCompiler();
        for (const operation of OPERATION_CATALOG.values()) {
            // Compiles the operation's configuration schema so it can check values.
            const compiled = compiler.compile(toJsonSchema(operation.configSchema));
            if (!compiled.ok) {
                throw new Error(`Expected ${operation.name}'s configuration schema to compile`);
            }

            // Checks an empty configuration passes and an extra member fails the closed schema.
            expect({
                operation: operation.name,
                empty: compiled.check({}),
                extra: compiled.check({ unexpected: 1 }).map((issue) => issue.keyword),
            }).toEqual({ operation: operation.name, empty: [], extra: ["additionalProperties"] });
        }
    });

    // Proves every output is closed and fully required, so steps can bind to any declared member.
    test("every output schema is closed and fully required", () => {
        for (const operation of OPERATION_CATALOG.values()) {
            // Reads the output schema as TypeBox and as plain JSON Schema.
            const schema = operation.outputSchema;
            const json = toJsonSchema(schema);

            // Checks the schema forbids extra members and requires every declared property.
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
        // Builds a TypeBox schema with one constraint keyword.
        const schema = Type.Number({ minimum: 0 });

        // Checks the view is the same object and serializes to only JSON Schema keywords.
        expect<unknown>(toJsonSchema(schema)).toBe(schema);
        expect(JSON.parse(JSON.stringify(toJsonSchema(schema)))).toEqual({
            type: "number",
            minimum: 0,
        });
    });
});
