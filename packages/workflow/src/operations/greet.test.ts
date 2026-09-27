/**
 * @fileoverview Tests `greet`'s declaration, chiefly its output schema.
 * Authors can't tighten a catalog output schema, so it must admit every
 * greeting the implementation returns and reject other strings, letting
 * later checks and conditions rely on the `Hello, <name>!` shape.
 *
 * GREET_OPERATION:
 * - takes a string name: any string, including the empty string, passes;
 *   a number or null fails `type`.
 * - admits every Hello greeting: `Hello, Ada!`, the empty-name
 *   `Hello, !`, and a name with a line break pass the compiled schema.
 * - rejects strings that aren't greetings: `hi` and `Hello, Ada` (no
 *   trailing `!`) fail on `pattern`.
 * - declares no failure codes: `failureCodes` is empty, because an invalid
 *   name is refused before dispatch.
 */

import { describe, expect, test } from "bun:test";
import { createDeclaredSchemaCompiler } from "../declared-schemas/declared-schema-compiler";
import { GREET_OPERATION } from "./greet";
import { toJsonSchema } from "./operation-catalog";

/** Checks a greeting against greet's declared output schema and returns the failed keywords. */
function checkGreeting(greeting: string): string[] {
    const compiled = createDeclaredSchemaCompiler().compile(
        toJsonSchema(GREET_OPERATION.outputSchema),
    );
    if (!compiled.ok) {
        throw new Error("Expected greet's output schema to compile");
    }
    return compiled.check({ greeting }).map((issue) => issue.keyword);
}

describe("GREET_OPERATION", () => {
    // Proves the name argument accepts any string and refuses other types before dispatch.
    test("takes a string name", () => {
        // Compiles the name schema the way publication checks a bound value.
        const compiled = createDeclaredSchemaCompiler().compile(
            toJsonSchema(GREET_OPERATION.arguments.name.schema),
        );
        if (!compiled.ok) {
            throw new Error("Expected greet's name schema to compile");
        }

        // Strings pass, including the empty name; other types fail on `type`.
        expect(compiled.check("Ada")).toEqual([]);
        expect(compiled.check("")).toEqual([]);
        expect(compiled.check(42).map((issue) => issue.keyword)).toEqual(["type"]);
        expect(compiled.check(null).map((issue) => issue.keyword)).toEqual(["type"]);
    });

    // Proves the output schema admits every greeting the operation produces, even for an empty name.
    test("admits every Hello greeting", () => {
        expect(checkGreeting("Hello, Ada!")).toEqual([]);
        expect(checkGreeting("Hello, !")).toEqual([]);
        expect(checkGreeting("Hello, line\nbreak!")).toEqual([]);
    });

    // Proves the output schema is tight enough for conditions to rule out other strings.
    test("rejects strings that aren't greetings", () => {
        expect(checkGreeting("hi")).toContain("pattern");
        expect(checkGreeting("Hello, Ada")).toContain("pattern");
    });

    // Proves greet has no domain failures, since an invalid name is refused before dispatch.
    test("declares no failure codes", () => {
        expect(GREET_OPERATION.failureCodes).toEqual([]);
    });
});
