import type { Finding } from "../../findings";
import type { ValidationContext } from "../validation-context";
import type { ValidationStage } from "../validation-stage";

/**
 * Stage 6: path and termination.
 *
 * Every reachable path from `firstNode` must end at a terminal `result`
 * step or at a conditional branch or default whose `next` is omitted
 * (an end-workflow branch). A terminal step outside a loop body must be
 * typed `result`; a loop body's terminal step may be any type, and its
 * outputs are collected per iteration. Dependency edges are included
 * when enumerating reachable paths, so parallel predecessors that join
 * through `dependencies` are not reported as unterminated (E1-S2).
 */
export class TerminationStage implements ValidationStage {
  readonly id = "termination";
  readonly prerequisites: readonly string[] = ["graph", "conditional"];

  /** Reports non-result terminals and unterminated paths among reachable leaves. */
  run(context: ValidationContext): Finding[] {
    const graph = context.graph;
    const document = graph.document;
    const findings: Finding[] = [];
    const edges = graph.orderingEdges(false);
    const leaves = new Set<string>();

    const visit = (stepId: string, path: Set<string>): void => {
      if (path.has(stepId)) return;
      path.add(stepId);
      const node = graph.stepNode(stepId);
      if (!node) {
        return;
      }
      const conditional = graph.conditionalForStep(stepId);
      if (conditional) {
        let hasOutgoing = false;
        for (const branch of conditional.branches) {
          if (branch.next) {
            hasOutgoing = true;
            visit(branch.next, new Set(path));
          }
        }
        if (conditional.default.next) {
          hasOutgoing = true;
          visit(conditional.default.next, new Set(path));
        }
        const endsHere =
          conditional.branches.some((branch) => !branch.next) || !conditional.default.next;
        if (!hasOutgoing || endsHere) {
          leaves.add(stepId);
        }
        return;
      }
      const targets = edges.get(stepId) ?? [];
      if (targets.length === 0) {
        leaves.add(stepId);
        return;
      }
      for (const target of targets) {
        visit(target, new Set(path));
      }
    };
    visit(document.firstNode, new Set());

    for (const leafId of leaves) {
      const node = graph.stepNode(leafId);
      if (!node) {
        continue;
      }
      const isTerminal =
        (node.step.successors?.length ?? 0) === 0 && node.step.conditional === undefined;
      if (isTerminal) {
        if (!graph.isInAnyLoopBody(leafId) && node.step.type !== "result") {
          findings.push(
            context.findings.create({
              code: "workflow.termination.non-result-terminal",
              message: `Reachable terminal step '${leafId}' must be typed 'result'`,
              path: `/steps/${node.index}/type`,
              details: { stepId: leafId, received: node.step.type },
            }),
          );
        }
        continue;
      }
      const conditional = graph.conditionalForStep(leafId);
      const endsViaConditional =
        conditional !== undefined &&
        (conditional.branches.some((branch) => !branch.next) || !conditional.default.next);
      if (!endsViaConditional) {
        findings.push(
          context.findings.create({
            code: "workflow.termination.unterminated-path",
            message: `Reachable path ends at '${leafId}' without a terminal result step or an end-workflow branch`,
            path: `/steps/${node.index}`,
            details: { stepId: leafId },
          }),
        );
      }
    }

    return findings;
  }
}
