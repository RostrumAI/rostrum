import { describe, expect, test } from "bun:test";
import { buildDocument, conditional, resultStep, taskStep } from "../../../tests/helpers/documents";
import { V1_RULE_SET } from "../../rules/v1";
import { ValidationContext } from "../validation-context";
import { IdentityStage } from "./identity-stage";

const stage = new IdentityStage(V1_RULE_SET.stepTypes);

function run(document: unknown) {
  return stage.run(new ValidationContext(document, null));
}

describe("IdentityStage", () => {
  test("accepts a well-referenced document", () => {
    const task = taskStep({ successors: [] });
    const end = resultStep();
    const document = buildDocument({ steps: [task, end], firstNode: task.id });
    expect(run(document)).toEqual([]);
  });

  test("reports duplicate step ids with the first occurrence", () => {
    const id = "0192b0a0-7e1d-7000-8000-0000000000aa";
    const document = buildDocument({ steps: [resultStep({ id }), resultStep({ id })] });
    const findings = run(document);
    const finding = findings.find(
      (candidate) => candidate.code === "workflow.identity.duplicate-step-id",
    );
    expect(finding?.path).toBe("/steps/1/id");
    expect(finding?.relatedLocations).toEqual([
      { path: "/steps/0/id", message: "first occurrence" },
    ]);
    expect(finding?.details).toEqual({ duplicateId: id });
  });

  test("reports duplicate conditional ids", () => {
    const step = taskStep({ conditional: "0192b0a0-7e1d-7000-8000-0000000000cb" });
    const sharedId = "0192b0a0-7e1d-7000-8000-0000000000cb";
    const document = buildDocument({
      steps: [step],
      conditionals: [
        conditional({ id: sharedId }),
        conditional({
          id: sharedId,
          branches: [
            {
              label: "b",
              priority: 0,
              condition: { ref: `step.${step.id}.o`, op: "eq", value: 1 },
            },
          ],
        }),
      ],
    });
    const findings = run(document);
    expect(
      findings.some((finding) => finding.code === "workflow.identity.duplicate-conditional-id"),
    ).toBe(true);
  });

  test("reports an unknown firstNode", () => {
    const document = buildDocument({ firstNode: "0192b0a0-7e1d-7000-8000-000000000099" });
    const findings = run(document);
    expect(findings[0]?.code).toBe("workflow.identity.first-node-unknown");
    expect(findings[0]?.path).toBe("/firstNode");
  });

  test("reports unknown targets for every reference field", () => {
    const missing = "0192b0a0-7e1d-7000-8000-000000000099";
    const looper = taskStep({
      loop: { collection: { ref: "inputs.f" }, maxIterations: 5, variable: "v", body: missing },
    });
    const branching = taskStep({ conditional: missing });
    const document = buildDocument({
      inputs: {},
      steps: [taskStep({ successors: [missing], dependencies: [missing] }), looper, branching],
      conditionals: [
        conditional({
          dependencies: [],
          branches: [
            {
              label: "b",
              priority: 0,
              condition: { ref: `step.${missing}.out`, op: "eq", value: 1 },
              next: missing,
            },
          ],
          default: { label: "fallback", next: missing },
        }),
      ],
    });
    const paths = run(document)
      .filter((finding) => finding.code === "workflow.reference.unknown-target")
      .map((finding) => finding.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/steps/0/successors/0",
        "/steps/0/dependencies/0",
        "/steps/1/loop/body",
        "/steps/2/conditional",
        "/conditionals/0/branches/0/next",
        "/conditionals/0/default/next",
      ]),
    );
  });

  test("reports an unregistered step type with supported types", () => {
    const document = buildDocument({ steps: [taskStep({ type: "no-such-type" })] });
    const findings = run(document);
    const finding = findings.find((candidate) => candidate.code === "workflow.step.unknown-type");
    expect(finding?.path).toBe("/steps/0/type");
    expect(finding?.details).toEqual({
      stepId: expect.any(String),
      received: "no-such-type",
      supported: ["result", "task"],
    });
  });

  test("enforces mutual exclusions of control-flow fields", () => {
    const conditionalId = "0192b0a0-7e1d-7000-8000-0000000000dd";
    const both = taskStep({ successors: [], conditional: conditionalId });
    const looped = taskStep({
      conditional: conditionalId,
      loop: { collection: { ref: "inputs.f" }, maxIterations: 1, variable: "v", body: both.id },
    });
    const document = buildDocument({
      steps: [both, looped],
      conditionals: [conditional({ id: conditionalId, dependencies: [] })],
    });
    const codes = run(document).map((finding) => {
      const fields = finding.details?.fields;
      return `${finding.code}:${Array.isArray(fields) ? fields.join("+") : ""}`;
    });
    expect(codes).toContain("workflow.shape.mutually-exclusive:successors+conditional");
    expect(codes).toContain("workflow.shape.mutually-exclusive:loop+conditional");
  });

  test("validates config against the registered schema for known types", () => {
    const missingOperation = taskStep({ config: {} });
    const wrongType = taskStep({ config: { operation: 42 } });
    const validTask = taskStep();
    const extraConfig = resultStep({ config: { anything: true } });
    const findings = run(
      buildDocument({ steps: [missingOperation, wrongType, validTask, extraConfig] }),
    );
    const invalid = findings.filter((finding) => finding.code === "workflow.step.invalid-config");
    expect(invalid.map((finding) => finding.path).sort()).toEqual([
      "/steps/0/config",
      "/steps/1/config",
    ]);
    expect(invalid[0]?.details?.type).toBe("task");
  });

  test("does not validate config of an unregistered type", () => {
    const findings = run(
      buildDocument({ steps: [taskStep({ type: "no-such-type", config: { garbage: 1 } })] }),
    );
    expect(findings.every((finding) => finding.code !== "workflow.step.invalid-config")).toBe(true);
  });
});
