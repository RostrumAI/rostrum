import { describe, expect, test } from "bun:test";
import { buildDocument, resultStep, taskStep } from "../tests/helpers/documents";
import { createWorkflowValidator } from "./workflow-validator";

const validator = createWorkflowValidator();

function sequentialText(): string {
  const task = taskStep();
  const end = resultStep();
  task.successors = [end.id];
  return JSON.stringify(buildDocument({ steps: [task, end] }));
}

describe("WorkflowValidator.validate", () => {
  test("returns no findings for valid text", () => {
    const result = validator.validate(sequentialText());
    expect(result.findings).toEqual([]);
    expect(result.validForPublication).toBe(true);
  });

  test("attaches line and column when validating text", () => {
    const text = '{\n  "interfaceVersion": "v2",\n  "id": "x"\n}';
    const result = validator.validate(text);
    const finding = result.findings.find(
      (candidate) => candidate.code === "workflow.version.unknown",
    );
    expect(finding?.line).toBe(2);
    expect(finding?.column).toBe(23);
  });

  test("rejects duplicate keys as parse errors and gates every stage", () => {
    const text = '{"interfaceVersion":"v1","interfaceVersion":"v1"}';
    const result = validator.validate(text);
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "workflow.parse.duplicate-key",
    ]);
    expect(result.findings[0]?.blocking).toBe(true);
    expect(result.validForPublication).toBe(false);
  });

  test("rejects NaN and Infinity literals", () => {
    expect(validator.validate('{"a": NaN}').findings[0]?.code).toBe("workflow.parse.json-invalid");
    expect(validator.validate('{"a": Infinity}').findings[0]?.code).toBe(
      "workflow.parse.json-invalid",
    );
  });

  test("rejects invalid UTF-8 bytes", () => {
    const result = validator.validate(new Uint8Array([0x7b, 0xc0, 0x80, 0x7d]));
    expect(result.findings[0]?.code).toBe("workflow.parse.invalid-utf8");
  });

  test("never falls back for an unknown interface version", () => {
    const result = validator.validate('{"interfaceVersion": "v2"}');
    expect(result.findings.map((finding) => finding.code)).toEqual(["workflow.version.unknown"]);
    expect(result.validForPublication).toBe(false);
  });
});

describe("WorkflowValidator.validateDocument", () => {
  test("validates a parsed document without line or column", () => {
    const task = taskStep({ id: "bad" });
    const result = validator.validateDocument(buildDocument({ steps: [task] }));
    expect(result.validForPublication).toBe(false);
    expect(
      result.findings.every(
        (finding) => finding.line === undefined && finding.column === undefined,
      ),
    ).toBe(true);
  });

  test("produces the same codes as text validation for the same document", () => {
    const document = buildDocument({ steps: [taskStep({ type: "no-such-type" })] });
    const fromText = validator.validate(JSON.stringify(document));
    const fromDocument = validator.validateDocument(document);
    expect(fromDocument.findings.map((finding) => finding.code)).toEqual(
      fromText.findings.map((finding) => finding.code),
    );
  });
});

describe("createWorkflowValidator", () => {
  test("builds independent validators with identical results", () => {
    const first = createWorkflowValidator().validate(sequentialText());
    const second = createWorkflowValidator().validate(sequentialText());
    expect(first).toEqual(second);
    expect(first.validForPublication).toBe(true);
  });

  test("supports only v1", () => {
    const result = createWorkflowValidator().validate('{"interfaceVersion": "v2"}');
    expect(result.findings.map((finding) => finding.code)).toEqual(["workflow.version.unknown"]);
  });
});
