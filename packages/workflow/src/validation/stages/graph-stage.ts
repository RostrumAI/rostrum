import type { Finding } from "../../findings";
import type { ValidationContext } from "../validation-context";
import type { ValidationStage } from "../validation-stage";

/**
 * Stage 4: graph topology.
 *
 * The combined control graph of `successors`, conditional branches, and
 * loop bodies must be acyclic, each loop body subgraph must be acyclic,
 * no step inside a loop body may declare a `loop` (no nesting in v1),
 * `maxIterations` must be a positive integer, and every dependency must
 * be reachable on all paths from `firstNode` to its dependent — the
 * merge-after-branch restriction, tested with dominator sets over the
 * control graph (E1-S2). Dependency reachability is skipped when a cycle
 * was found: dominators are only meaningful on an acyclic graph.
 */
export class GraphStage implements ValidationStage {
  readonly id = "graph";
  readonly prerequisites: readonly string[] = ["identity"];

  /** Reports cycle, nesting, loop-bound, and dependency-reachability findings. */
  run(context: ValidationContext): Finding[] {
    const graph = context.graph;
    const findings: Finding[] = [];

    graph.document.steps.forEach((step, index) => {
      const loop = step.loop;
      if (loop && (!Number.isInteger(loop.maxIterations) || loop.maxIterations < 1)) {
        findings.push(
          context.findings.create({
            code: "workflow.loop.invalid-max-iterations",
            message: "loop.maxIterations must be an integer >= 1",
            path: `/steps/${index}/loop/maxIterations`,
            details: { stepId: step.id, received: loop.maxIterations },
          }),
        );
      }
    });

    graph.document.steps.forEach((step) => {
      if (!step.loop) return;
      for (const memberId of graph.loopBodyMembers(step.id)) {
        const member = graph.stepNode(memberId);
        if (!member || memberId === step.id || !member.step.loop) continue;
        findings.push(
          context.findings.create({
            code: "workflow.loop.nested",
            message: `Nested loop: step '${memberId}' inside the loop body of '${step.id}' declares a loop`,
            path: `/steps/${member.index}/loop`,
            details: { outerLoop: step.id, innerLoop: memberId },
          }),
        );
      }
    });

    graph.document.steps.forEach((step, index) => {
      if (!step.loop) return;
      const cycle = graph.findBodyCycle(step.id);
      if (cycle) {
        findings.push(
          context.findings.create({
            code: "workflow.graph.cycle",
            message: `Loop body of '${step.id}' contains a cycle`,
            path: `/steps/${index}/loop/body`,
            details: { loop: step.id, cycle },
          }),
        );
      }
    });

    const cycle = graph.findCycle();
    if (cycle) {
      findings.push(
        context.findings.create({
          code: "workflow.graph.cycle",
          message: "The workflow graph contains a cycle",
          path: "",
          details: { cycle },
        }),
      );
    }

    if (findings.some((finding) => finding.code === "workflow.graph.cycle")) return findings;

    const dominators = graph.dominators();
    const reachable = graph.controlReachableFromFirstNode();
    graph.document.steps.forEach((step, index) => {
      if (!reachable.has(step.id)) return;
      for (const dependency of step.dependencies ?? []) {
        if (dominators.get(step.id)?.has(dependency)) continue;
        const dependencyNode = graph.stepNode(dependency);
        findings.push(
          context.findings.create({
            code: "workflow.graph.unreachable-dependency",
            message: `Dependency '${dependency}' is not reachable on all paths from firstNode to '${step.id}'`,
            path: `/steps/${index}/dependencies`,
            relatedLocations: dependencyNode
              ? [{ path: `/steps/${dependencyNode.index}/id`, message: "dependency step" }]
              : undefined,
            details: { step: step.id, dependency },
          }),
        );
      }
    });

    return findings;
  }
}
