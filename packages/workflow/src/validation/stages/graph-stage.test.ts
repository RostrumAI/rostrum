import { describe, expect, test } from "bun:test";
import {
  buildDocument,
  resultStep,
  taskLoopStep,
  taskStep,
} from "../../../tests/helpers/documents";
import { V1_RULE_SET } from "../../rules/v1";
import { ValidationContext } from "../validation-context";
import { GraphStage } from "./graph-stage";

const stage = new GraphStage();

function run(document: unknown) {
  const context = new ValidationContext(document, null);
  context.selectRuleSet(V1_RULE_SET);
  return stage.run(context);
}

describe("GraphStage", () => {
  test("accepts an acyclic document", () => {
    const task = taskStep({ successors: [] });
    expect(run(buildDocument({ steps: [task, resultStep()], firstNode: task.id }))).toEqual([]);
  });

  test("reports a successor cycle with the cycle path", () => {
    const a = taskStep();
    const b = taskStep({ successors: [a.id] });
    a.successors = [b.id];
    const findings = run(buildDocument({ steps: [a, b], firstNode: a.id }));
    const finding = findings.find((candidate) => candidate.code === "workflow.graph.cycle");
    expect(finding?.path).toBe("");
    expect(finding?.details?.cycle).toEqual(expect.arrayContaining([a.id, b.id, a.id]));
  });

  test("reports a loop body cycle at the loop body pointer", () => {
    const end = resultStep();
    const bodyFirst = taskStep({ successors: [] });
    const bodySecond = taskStep({ successors: [bodyFirst.id] });
    bodyFirst.successors = [bodySecond.id];
    const loop = taskLoopStep({
      collection: { ref: "inputs.f" },
      maxIterations: 5,
      variable: "v",
      body: bodyFirst.id,
    });
    const findings = run(
      buildDocument({
        steps: [loop, bodyFirst, bodySecond, end],
        firstNode: loop.id,
        inputs: { f: { type: "array" } },
      }),
    );
    const finding = findings.find((candidate) => candidate.code === "workflow.graph.cycle");
    expect(finding?.path).toBe("/steps/0/loop/body");
    expect(finding?.details?.loop).toBe(loop.id);
  });

  test("reports a nested loop", () => {
    const end = resultStep();
    const inner = taskLoopStep({
      collection: { ref: "inputs.f" },
      maxIterations: 5,
      variable: "w",
      body: end.id,
    });
    const outer = taskLoopStep({
      collection: { ref: "inputs.f" },
      maxIterations: 5,
      variable: "v",
      body: inner.id,
    });
    const findings = run(
      buildDocument({
        steps: [outer, inner, end],
        firstNode: outer.id,
        inputs: { f: { type: "array" } },
      }),
    );
    const finding = findings.find((candidate) => candidate.code === "workflow.loop.nested");
    expect(finding?.details).toEqual({ outerLoop: outer.id, innerLoop: inner.id });
    expect(finding?.path).toBe("/steps/1/loop");
  });

  test("re-checks maxIterations as a positive integer", () => {
    const end = resultStep();
    const loop = taskStep({
      loop: { collection: { ref: "inputs.f" }, maxIterations: 0, variable: "v", body: end.id },
    });
    const findings = run(
      buildDocument({ steps: [loop, end], firstNode: loop.id, inputs: { f: { type: "array" } } }),
    );
    expect(
      findings.some((finding) => finding.code === "workflow.loop.invalid-max-iterations"),
    ).toBe(true);
  });

  test("flags a dependency that is not reachable on all paths (merge-after-branch)", () => {
    // firstNode branches to B (which ends) and C, which flows to D; D depends on B.
    const branch = taskStep();
    const b = taskStep();
    const c = taskStep({ successors: [] });
    const d = taskStep({ dependencies: [b.id], successors: [] });
    const end = resultStep();
    branch.successors = [b.id, c.id];
    b.successors = [d.id];
    c.successors = [d.id];
    d.successors = [end.id];
    const findings = run(buildDocument({ steps: [branch, b, c, d, end], firstNode: branch.id }));
    const finding = findings.find(
      (candidate) => candidate.code === "workflow.graph.unreachable-dependency",
    );
    expect(finding?.details).toEqual({ step: d.id, dependency: b.id });
    expect(finding?.relatedLocations).toEqual([
      { path: `/steps/${1}/id`, message: "dependency step" },
    ]);
  });

  test("accepts a dependency on a transitive control predecessor", () => {
    const a = taskStep();
    const b = taskStep({ successors: [] });
    const c = taskStep({ successors: [], dependencies: [a.id] });
    a.successors = [b.id];
    b.successors = [c.id];
    const end = resultStep();
    c.successors = [end.id];
    expect(run(buildDocument({ steps: [a, b, c, end], firstNode: a.id }))).toEqual([]);
  });

  test("accepts pure fan-in joins whose dependencies are not dominators", () => {
    // Five reviewers run in parallel; the join waits on all of them via
    // dependencies and has no incoming control edges.
    const trigger = taskStep();
    const reviewers = Array.from({ length: 5 }, () => taskStep());
    const join = taskStep({
      dependencies: reviewers.map((reviewer) => reviewer.id),
      successors: [],
    });
    trigger.successors = reviewers.map((reviewer) => reviewer.id);
    const end = resultStep();
    join.successors = [end.id];
    const findings = run(
      buildDocument({ steps: [trigger, ...reviewers, join, end], firstNode: trigger.id }),
    );
    expect(findings).toEqual([]);
  });
});
