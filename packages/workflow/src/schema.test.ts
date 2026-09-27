/**
 * @fileoverview Tests the workflow document's shape schema, the first check
 * every saved or published document passes. It must accept every shape the
 * format allows and reject malformed ones for the documented reason.
 *
 * - valid examples: every `valid/` fixture has no shape errors.
 * - incomplete drafts: every `incomplete/` fixture fails only for missing
 *   members, so a draft is never malformed beyond omission.
 * - invalid shape examples: each `invalid-shape/` fixture fails at the
 *   member it was written to break (format version, missing or unknown
 *   member, malformed ID, empty steps, loop bound, loop collection,
 *   conditional default).
 * - workflow input declarations: a default of any value and a boolean schema
 *   are accepted; the bare pre-declaration form, a missing schema, an extra
 *   member, and a non-schema `schema` are rejected at the input.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Compile } from "typebox/compile";
import { WorkflowDocumentSchema } from "./schema";
import { buildDocument } from "./testing/documents";

const FIXTURES_DIR = join(import.meta.dir, "fixtures");

function loadFixture(...segments: string[]): Record<string, unknown> {
    const raw = readFileSync(join(FIXTURES_DIR, ...segments), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`Fixture is not a JSON object: ${segments.join("/")}`);
    }
    return parsed as Record<string, unknown>;
}

function loadCategory(name: string): string[] {
    return readdirSync(join(FIXTURES_DIR, name))
        .filter((file) => file.endsWith(".json"))
        .sort();
}

const validator = Compile(WorkflowDocumentSchema);

describe("valid examples pass schema validation", () => {
    for (const file of loadCategory("valid")) {
        test(file, () => {
            const document = loadFixture("valid", file);
            const errors = [...validator.Errors(document)];
            expect(errors).toEqual([]);
            expect(validator.Check(document)).toBe(true);
        });
    }
});

describe("incomplete drafts are saveable documents", () => {
    // Any syntactically valid JSON saves as a draft, so a draft may
    // carry blocking findings from any pipeline stage. The schema stage may
    // report missing members for a fresh workflow, but nothing else: an
    // incomplete document is never malformed beyond omission.
    for (const file of loadCategory("incomplete")) {
        test(file, () => {
            const document = loadFixture("incomplete", file);
            const errors = [...validator.Errors(document)];
            expect(errors.every((error) => error.keyword === "required")).toBe(true);
        });
    }
});

describe("invalid shape examples fail for the expected reason", () => {
    test("unknown-workflow-format-version.json: workflowFormatVersion is not v1", () => {
        const document = loadFixture("invalid-shape", "unknown-workflow-format-version.json");
        const pointers = [...validator.Errors(document)].map((error) => error.instancePath);
        expect(pointers).toContain("/workflowFormatVersion");
    });

    test("missing-required-field.json: firstNode is absent", () => {
        const document = loadFixture("invalid-shape", "missing-required-field.json");
        const errors = [...validator.Errors(document)];
        expect(
            errors.some(
                (error) =>
                    error.keyword === "required" &&
                    error.params.requiredProperties.includes("firstNode"),
            ),
        ).toBe(true);
    });

    test("unknown-field.json: top level declares an unknown member", () => {
        const document = loadFixture("invalid-shape", "unknown-field.json");
        const errors = [...validator.Errors(document)];
        expect(
            errors.some(
                (error) =>
                    error.keyword === "additionalProperties" &&
                    error.params.additionalProperties.includes("revisions"),
            ),
        ).toBe(true);
    });

    test("malformed-uuid.json: firstNode is not a UUID v7 string", () => {
        const document = loadFixture("invalid-shape", "malformed-uuid.json");
        const pointers = [...validator.Errors(document)].map((error) => error.instancePath);
        expect(pointers).toContain("/firstNode");
    });

    test("empty-steps.json: steps has fewer than one item", () => {
        const document = loadFixture("invalid-shape", "empty-steps.json");
        const pointers = [...validator.Errors(document)].map((error) => error.instancePath);
        expect(pointers).toContain("/steps");
    });

    test("loop-bound-below-one.json: maxIterations is below one", () => {
        const document = loadFixture("invalid-shape", "loop-bound-below-one.json");
        const pointers = [...validator.Errors(document)].map((error) => error.instancePath);
        expect(pointers).toContain("/steps/0/loop/maxIterations");
    });

    test("loop-missing-collection.json: loop collection is absent", () => {
        const document = loadFixture("invalid-shape", "loop-missing-collection.json");
        const pointers = [...validator.Errors(document)].map((error) => error.instancePath);
        expect(pointers).toContain("/steps/0/loop");
    });

    test("conditional-default-missing.json: conditional default is absent", () => {
        const document = loadFixture("invalid-shape", "conditional-default-missing.json");
        const pointers = [...validator.Errors(document)].map((error) => error.instancePath);
        expect(pointers).toContain("/conditionals/0");
    });
});

describe("workflow input declarations", () => {
    /** Returns the pointers of every shape error for a document declaring the given inputs. */
    function getInputErrorPaths(inputs: unknown): string[] {
        const document = { ...buildDocument(), inputs };
        return [...validator.Errors(document)].map((error) => error.instancePath);
    }

    // Proves a declaration may carry a default, of any JSON value, including null.
    test("accepts a default", () => {
        expect(getInputErrorPaths({ count: { schema: { type: "number" }, default: 3 } })).toEqual(
            [],
        );
        expect(getInputErrorPaths({ note: { schema: { type: "null" }, default: null } })).toEqual(
            [],
        );
    });

    // Proves `true` and `false` are whole schemas, so either is a valid declaration.
    test("accepts a boolean schema", () => {
        expect(
            getInputErrorPaths({ anything: { schema: true }, nothing: { schema: false } }),
        ).toEqual([]);
    });

    // Proves the old bare form, a missing schema, and an extra member are all shape errors.
    test("rejects malformed declarations", () => {
        expect(getInputErrorPaths({ name: { type: "string" } })).toContain("/inputs/name");
        expect(getInputErrorPaths({ name: { default: "Ada" } })).toContain("/inputs/name");
        expect(
            getInputErrorPaths({ name: { schema: { type: "string" }, required: true } }),
        ).toContain("/inputs/name");
    });

    // Proves a schema that is neither an object nor a boolean is a shape error at the schema.
    test("rejects a non-schema value", () => {
        expect(getInputErrorPaths({ name: { schema: "string" } })).toContain("/inputs/name/schema");
    });
});
