import { describe, expect, test } from "bun:test";
import {
  buildDocument,
  conditional,
  resultStep,
  taskLoopStep,
  taskStep,
} from "../../../tests/helpers/documents";
import { V1_RULE_SET } from "../../rules/v1";
import { ValidationContext } from "../validation-context";
import { TerminationStage } from "./termination-stage";

const stage = new TerminationStage();

function run(document: unknown) {
  const context = new ValidationContext(document, null);
  context.selectRuleSet(V1_RULE_SET);
  return stage.run(context);
}

describe("TerminationStage", () => {
  test("accepts a sequential workflow ending in a result step", () => {
    const task = taskStep();
    const end = resultStep();
    task.successors = [end.id];
    const document = buildDocument({ steps: [task, end], firstNode: task.id });
    expect(run(document)).toEqual([]);
  });

  test("flags a reachable terminal step that is not a result", () => {
    const task = taskStep({ successors: [] });
    const dangling = taskStep();
    task.successors = [dangling.id];
    const findings = run(buildDocument({ steps: [task, dangling], firstNode: task.id }));
    const finding = findings.find(
      (candidate) => candidate.code === "workflow.termination.non-result-terminal",
    );
    expect(finding?.path).toBe("/steps/1/type");
    expect(finding?.details).toEqual({ stepId: dangling.id, received: "task" });
  });

  test("accepts an end-workflow conditional branch of any step type", () => {
    const owner = taskStep({ conditional: "0192b0a0-7e1d-7000-8000-0000000000f0" });
    const routing = conditional({
      id: "0192b0a0-7e1d-7000-8000-0000000000f0",
      dependencies: [owner.id],
      branches: [
        { label: "only", priority: 0, condition: { ref: `step.${owner.id}.out`, op: "truthy" } },
      ],
      default: { label: "fallback" },
    });
    const document = buildDocument({ steps: [owner], conditionals: [routing] });
    expect(run(document)).toEqual([]);
  });

  test("accepts mixed branches where some end and some continue", () => {
    const owner = taskStep({ conditional: "0192b0a0-7e1d-7000-8000-0000000000f1" });
    const next = resultStep();
    const routing = conditional({
      id: "0192b0a0-7e1d-7000-8000-0000000000f1",
      dependencies: [owner.id],
      branches: [
        {
          label: "ends",
          priority: 0,
          condition: { ref: `step.${owner.id}.out`, op: "eq", value: "a" },
        },
        {
          label: "continues",
          priority: 1,
          condition: { ref: `step.${owner.id}.out`, op: "eq", value: "b" },
          next: next.id,
        },
      ],
      default: { label: "fallback", next: next.id },
    });
    const document = buildDocument({ steps: [owner, next], conditionals: [routing] });
    expect(run(document)).toEqual([]);
  });

  test("accepts any terminal type inside a loop body", () => {
    const bodyTerminal = taskStep({ successors: [] });
    const loop = taskLoopStep({
      collection: { ref: "inputs.f" },
      maxIterations: 5,
      variable: "v",
      body: bodyTerminal.id,
    });
    const afterLoop = resultStep();
    loop.successors = [afterLoop.id];
    const document = buildDocument({
      steps: [loop, bodyTerminal, afterLoop],
      firstNode: loop.id,
      inputs: { f: { type: "array" } },
    });
    expect(run(document)).toEqual([]);
  });

  test("does not flag parallel predecessors that join through dependencies", () => {
    const trigger = taskStep();
    const reviewerA = taskStep();
    const reviewerB = taskStep();
    const join = taskStep({ dependencies: [reviewerA.id, reviewerB.id], successors: [] });
    trigger.successors = [reviewerA.id, reviewerB.id];
    const end = resultStep();
    join.successors = [end.id];
    const document = buildDocument({
      steps: [trigger, reviewerA, reviewerB, join, end],
      firstNode: trigger.id,
    });
    expect(run(document)).toEqual([]);
  });
});
