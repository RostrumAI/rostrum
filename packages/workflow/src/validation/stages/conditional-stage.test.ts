import { describe, expect, test } from "bun:test";
import { buildDocument, conditional, resultStep, taskStep } from "../../../tests/helpers/documents";
import { V1_RULE_SET } from "../../rules/v1";
import { ValidationContext } from "../validation-context";
import { ConditionalStage } from "./conditional-stage";

const stage = new ConditionalStage();

function run(document: unknown) {
  const context = new ValidationContext(document, null);
  context.selectRuleSet(V1_RULE_SET);
  return stage.run(context);
}

function branchingDocument(overrides: {
  dependencies?: string[];
  branches?: ReturnType<typeof conditional>["branches"];
  default?: { label: string; next?: string };
  extraSteps?: NonNullable<Parameters<typeof buildDocument>[0]>["steps"];
}) {
  const owner = taskStep({ conditional: "0192b0a0-7e1d-7000-8000-0000000000e0" });
  const nextStep = resultStep();
  const routing = conditional({
    id: "0192b0a0-7e1d-7000-8000-0000000000e0",
    dependencies: overrides.dependencies ?? [owner.id],
    branches: overrides.branches ?? [
      {
        label: "high",
        priority: 0,
        condition: { ref: `step.${owner.id}.decision`, op: "eq", value: "high" },
        next: nextStep.id,
      },
    ],
    default: overrides.default ?? { label: "fallback" },
  });
  return {
    owner,
    nextStep,
    document: buildDocument({
      steps: [owner, nextStep, ...(overrides.extraSteps ?? [])],
      conditionals: [routing],
    }),
  };
}

describe("ConditionalStage", () => {
  test("accepts a conditional whose condition refs are covered by dependencies", () => {
    const { document } = branchingDocument({});
    expect(run(document)).toEqual([]);
  });

  test("reports a condition step missing from the conditional dependencies", () => {
    const { owner, document } = branchingDocument({ dependencies: [] });
    const finding = run(document).find(
      (candidate) => candidate.code === "workflow.conditional.missing-dependency",
    );
    expect(finding?.path).toBe("/conditionals/0/dependencies");
    expect(finding?.details).toEqual({
      conditionalId: "0192b0a0-7e1d-7000-8000-0000000000e0",
      referencedStep: owner.id,
      ref: `step.${owner.id}.decision`,
    });
  });

  test("reports an unknown predicate operator", () => {
    const { owner, document } = branchingDocument({});
    const conditionalObject = (
      document as { conditionals: Array<{ branches: Array<{ condition: unknown }> }> }
    ).conditionals[0];
    const firstBranch = conditionalObject?.branches[0];
    if (firstBranch) {
      firstBranch.condition = { ref: `step.${owner.id}.decision`, op: "approx", value: 1 };
    }
    const finding = run(document).find(
      (candidate) => candidate.code === "workflow.conditional.invalid-operator",
    );
    expect(finding?.details?.operator).toBe("approx");
  });

  test("reports a leaf ref that is not step.<id>.<output>", () => {
    const { document } = branchingDocument({
      branches: [
        { label: "b", priority: 0, condition: { ref: "inputs.score", op: "eq", value: 1 } },
      ],
    });
    const finding = run(document).find(
      (candidate) => candidate.code === "workflow.conditional.invalid-ref",
    );
    expect(finding?.details?.ref).toBe("inputs.score");
  });
  test("reports a condition referencing an unknown step", () => {
    const missing = "0192b0a0-7e1d-7000-8000-000000000099";
    const { document } = branchingDocument({
      dependencies: [missing],
      branches: [
        { label: "b", priority: 0, condition: { ref: `step.${missing}.out`, op: "eq", value: 1 } },
      ],
    });
    const finding = run(document).find(
      (candidate) => candidate.code === "workflow.conditional.unknown-step",
    );
    expect(finding?.details?.stepId).toBe(missing);
  });

  test("collects refs nested in all/any groups for the dependency check", () => {
    const other = taskStep();
    const { document } = branchingDocument({
      dependencies: [],
      branches: [
        {
          label: "grouped",
          priority: 0,
          condition: {
            all: [{ any: [{ ref: `step.${other.id}.output`, op: "eq", value: 1 }] }],
          },
        },
      ],
      extraSteps: [other],
    });
    const findings = run(document);
    expect(
      findings.some((finding) => finding.code === "workflow.conditional.missing-dependency"),
    ).toBe(true);
    expect(findings.every((finding) => finding.code !== "workflow.conditional.invalid-ref")).toBe(
      true,
    );
  });

  test("reports empty branch lists defensively", () => {
    const owner = taskStep({ conditional: "0192b0a0-7e1d-7000-8000-0000000000e1" });
    const routing = conditional({
      id: "0192b0a0-7e1d-7000-8000-0000000000e1",
      branches: [],
      dependencies: [owner.id],
    });
    const findings = run(buildDocument({ steps: [owner], conditionals: [routing] }));
    expect(findings.some((finding) => finding.code === "workflow.conditional.empty-branches")).toBe(
      true,
    );
  });
  test("reports empty all and any groups", () => {
    const { document } = branchingDocument({
      branches: [
        { label: "empty-all", priority: 0, condition: { all: [] } },
        { label: "empty-any", priority: 1, condition: { any: [] } },
      ],
    });
    const findings = run(document);
    const emptyGroups = findings.filter((finding) => finding.code === "workflow.conditional.empty-group");
    expect(emptyGroups.map((finding) => finding.path)).toEqual([
      "/conditionals/0/branches/0/condition/all",
      "/conditionals/0/branches/1/condition/any",
    ]);
  });

  test("ignores condition values that are neither leaves nor composites", () => {
    const { owner, document } = branchingDocument({});
    const conditionalObject = (
      document as { conditionals: Array<{ branches: Array<{ condition: unknown }> }> }
    ).conditionals[0];
    const firstBranch = conditionalObject?.branches[0];
    if (firstBranch) {
      firstBranch.condition = "not-a-condition";
    }
    expect(run(document)).toEqual([]);
    expect(owner).toBeDefined();
  });
});
