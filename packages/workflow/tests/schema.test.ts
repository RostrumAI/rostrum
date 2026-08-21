import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Compile } from "typebox/compile";
import { WorkflowDocument } from "../src/schema";
import { digestWorkflow } from "./helpers/digest";

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

describe("incomplete drafts pass schema validation", () => {
  // Incomplete drafts are syntactically valid and shape-valid; their blocking
  // findings (unknown successor target, unknown step type) come from stages 3
  // and later of the validation pipeline (E1-04), so they save as drafts.
  for (const file of loadCategory("incomplete")) {
    test(file, () => {
      const document = loadFixture("incomplete", file);
      expect(validator.Check(document)).toBe(true);
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
          error.keyword === "required" && error.params.requiredProperties.includes("firstNode"),
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

describe("digest vectors match the E1-S3 fixture table", () => {
  // SHA-256 hex over the RFC 8785 canonical form with `name` and
  // `description` removed, per E1-S3 as amended by E1-S4 decision 4a.
  const expectedDigests: Record<string, string> = {
    "sequential.json": "e7a05eeb289860e3e43d3054622d070e715893397d0ed44a8f814265bf46b368",
    "conditional-branching.json":
      "62060162c41188816562fcca6c75899f212f46fbda8ab41ebe458bfd93f8698a",
    "bounded-loop.json": "5003b9d73650da0605ffbdd11c61f2e370f10f23070f2ff136f01f679808fa92",
    "conditional-groups.json": "5793efea91c0206dc646b845b5656162906c70f2cf6ce88f8fb0e59bda4ea04b",
  };

  for (const [file, expected] of Object.entries(expectedDigests)) {
    test(file, async () => {
      const document = loadFixture("valid", file);
      expect(await digestWorkflow(document)).toBe(expected);
    });
  }

  test("a metadata-only edit leaves the digest unchanged", async () => {
    const document = loadFixture("valid", "sequential.json");
    const renamed = {
      ...document,
      name: "Renamed workflow",
      description: "Different description.",
    };
    const expected = expectedDigests["sequential.json"];
    if (expected === undefined) throw new Error("missing sequential digest vector");
    expect(await digestWorkflow(renamed as Record<string, unknown>)).toBe(expected);
  });
});
