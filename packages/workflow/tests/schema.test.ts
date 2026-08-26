import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Compile } from "typebox/compile";
import { WorkflowDocument } from "../src/schema";

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

const validator = Compile(WorkflowDocument);

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
    // Any syntactically valid JSON saves as a draft (E1-S3), so a draft may
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
    test("unknown-interface-version.json: interfaceVersion is not v1", () => {
        const document = loadFixture("invalid-shape", "unknown-interface-version.json");
        const pointers = [...validator.Errors(document)].map((error) => error.instancePath);
        expect(pointers).toContain("/interfaceVersion");
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
