import { describe, expect, test } from "bun:test";
import { createDeclaredSchemaCompiler } from "../declared-schemas/declared-schema-compiler";
import { GREET_OPERATION } from "./greet";
import { toJsonSchema } from "./operation-catalog";

/** Checks a greeting against greet's declared output schema and returns the failed keywords. */
function outputIssuesFor(greeting: string): string[] {
    const compiled = createDeclaredSchemaCompiler().compile(
        toJsonSchema(GREET_OPERATION.outputSchema),
    );
    if (!compiled.ok) {
        throw new Error("Expected greet's output schema to compile");
    }
    return compiled.check({ greeting }).map((issue) => issue.keyword);
}

describe("GREET_OPERATION", () => {
    // Proves the output schema admits every greeting the operation produces, even for an empty name.
    test("admits every Hello greeting", () => {
        expect(outputIssuesFor("Hello, Ada!")).toEqual([]);
        expect(outputIssuesFor("Hello, !")).toEqual([]);
        expect(outputIssuesFor("Hello, line\nbreak!")).toEqual([]);
    });

    // Proves the output schema is tight enough for conditions to rule out other strings.
    test("rejects strings that aren't greetings", () => {
        expect(outputIssuesFor("hi")).toContain("pattern");
        expect(outputIssuesFor("Hello, Ada")).toContain("pattern");
    });

    // Proves greet has no domain failures, since an invalid name is refused before dispatch.
    test("declares no failure codes", () => {
        expect(GREET_OPERATION.failureCodes).toEqual([]);
    });
});
