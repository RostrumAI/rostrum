import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createWorkflowValidator } from "../src/workflow-validator";

const FIXTURES_DIR = join(import.meta.dir, "fixtures");
const validator = createWorkflowValidator();

function loadFixture(...segments: string[]): string {
  return readFileSync(join(FIXTURES_DIR, ...segments), "utf8");
}

function fixtureFiles(category: string): string[] {
  return readdirSync(join(FIXTURES_DIR, category))
    .filter((file) => file.endsWith(".json"))
    .sort();
}

describe("valid fixtures validate cleanly from text", () => {
  for (const file of fixtureFiles("valid")) {
    test(file, () => {
      const result = validator.validate(loadFixture("valid", file));
      expect(result.findings).toEqual([]);
      expect(result.validForPublication).toBe(true);
    });
  }
});

describe("incomplete fixtures save as drafts with blocking findings", () => {
  test("unfinished-connection.json reports the unknown successor target", () => {
    const result = validator.validate(loadFixture("incomplete", "unfinished-connection.json"));
    expect(result.validForPublication).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toContain(
      "workflow.reference.unknown-target",
    );
    expect(result.findings.every((finding) => !finding.code.startsWith("workflow.shape."))).toBe(
      true,
    );
  });

  test("unknown-step-type.json reports the unregistered type", () => {
    const result = validator.validate(loadFixture("incomplete", "unknown-step-type.json"));
    expect(result.validForPublication).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toEqual(["workflow.step.unknown-type"]);
    expect(result.findings[0]?.details?.supported).toEqual(["result", "task"]);
  });
});

describe("invalid-shape fixtures fail with their shape or version finding", () => {
  const expected: Record<string, string> = {
    "unknown-interface-version.json": "workflow.version.unknown",
    "missing-required-field.json": "workflow.shape.required-field",
    "unknown-field.json": "workflow.shape.unknown-field",
    "malformed-uuid.json": "workflow.shape.format",
    "empty-steps.json": "workflow.shape.constraint",
    "loop-bound-below-one.json": "workflow.shape.constraint",
    "loop-missing-collection.json": "workflow.shape.required-field",
    "conditional-default-missing.json": "workflow.shape.required-field",
  };

  for (const [file, code] of Object.entries(expected)) {
    test(file, () => {
      const result = validator.validate(loadFixture("invalid-shape", file));
      expect(result.validForPublication).toBe(false);
      expect(result.findings.map((finding) => finding.code)).toContain(code);
    });
  }

  test("unknown-interface-version.json produces only the version finding", () => {
    const result = validator.validate(
      loadFixture("invalid-shape", "unknown-interface-version.json"),
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.details?.supported).toEqual(["v1"]);
  });
});

describe("findings carry source locations from text", () => {
  test("the unknown-field finding points at the offending line", () => {
    const result = validator.validate(loadFixture("invalid-shape", "unknown-field.json"));
    const finding = result.findings.find(
      (candidate) => candidate.code === "workflow.shape.unknown-field",
    );
    expect(finding?.line).toBeGreaterThan(0);
    expect(finding?.column).toBeGreaterThan(0);
  });

  test("the unfinished-connection finding carries a pointer and location", () => {
    const result = validator.validate(loadFixture("incomplete", "unfinished-connection.json"));
    const finding = result.findings.find(
      (candidate) => candidate.code === "workflow.reference.unknown-target",
    );
    expect(finding?.path).toBe("/steps/0/successors/0");
    expect(finding?.line).toBeGreaterThan(0);
  });
});
