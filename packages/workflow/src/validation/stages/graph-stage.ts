import type { Finding } from "../../findings";
import type { ValidationContext } from "../validation-context";
import type { ValidationStage } from "../validation-stage";
import type { WorkflowGraph } from "../workflow-graph";

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

        // The stage runs four checks in order:
        // 1. Loop bounds: every maxIterations is an integer >= 1.
        // 2. Nesting: no step inside a loop body declares its own loop.
        // 3. Acyclicity: each loop body subgraph, then the whole graph.
        this.checkLoopBounds(context, findings);
        this.checkNestedLoops(graph, context, findings);
        this.checkBodyCycles(graph, context, findings);
        this.checkWholeGraphCycles(graph, context, findings);

        // Dominator sets are only defined on acyclic graphs, so the final
        // dependency check runs only when no cycle was reported above.
        const foundCycle = findings.some((finding) => finding.code === "workflow.graph.cycle");
        if (!foundCycle) {
            this.checkDependencyDominance(graph, context, findings);
        }
        return findings;
    }

    /** Reports loops whose `maxIterations` is not an integer >= 1. */
    private checkLoopBounds(context: ValidationContext, findings: Finding[]): void {
        const steps = context.typedDocument.steps;
        for (const [index, step] of steps.entries()) {
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
        }
    }

    /**
     * Reports nested loops.
     *
     * For every declared loop, the walk visits the members of its body
     * subgraph and reports any member that declares a loop of its own;
     * v1 forbids nesting one level deep or deeper.
     */
    private checkNestedLoops(
        graph: WorkflowGraph,
        context: ValidationContext,
        findings: Finding[],
    ): void {
        const steps = context.typedDocument.steps;
        for (const step of steps) {
            if (!step.loop) {
                continue;
            }
            for (const memberId of graph.loopBodyMembers(step.id)) {
                const member = graph.stepNode(memberId);
                // Skip the loop step itself (it is trivially in its own body)
                // and members without a nested loop declaration.
                if (!member || memberId === step.id || !member.step.loop) {
                    continue;
                }
                findings.push(
                    context.findings.create({
                        code: "workflow.loop.nested",
                        message: `Nested loop: step '${memberId}' inside the loop body of '${step.id}' declares a loop`,
                        path: `/steps/${member.index}/loop`,
                        details: { outerLoop: step.id, innerLoop: memberId },
                    }),
                );
            }
        }
    }

    /** Reports cycles inside individual loop body subgraphs. */
    private checkBodyCycles(
        graph: WorkflowGraph,
        context: ValidationContext,
        findings: Finding[],
    ): void {
        const steps = context.typedDocument.steps;
        for (const [index, step] of steps.entries()) {
            if (!step.loop) {
                continue;
            }
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
        }
    }

    /** Reports a cycle across the combined control graph of the workflow. */
    private checkWholeGraphCycles(
        graph: WorkflowGraph,
        context: ValidationContext,
        findings: Finding[],
    ): void {
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
    }

    /**
     * Reports dependencies that are not reachable on all paths from
     * `firstNode` to their dependent.
     *
     * A dependency dominates its dependent exactly when every control
     * path passes through it; that is the merge-after-branch rule of
     * E1-S2. Steps unreachable from `firstNode` are skipped because their
     * reachability is reported by the termination stage.
     */
    private checkDependencyDominance(
        graph: WorkflowGraph,
        context: ValidationContext,
        findings: Finding[],
    ): void {
        const dominators = graph.dominators();
        const reachable = graph.controlReachableFromFirstNode();
        const steps = context.typedDocument.steps;
        for (const [index, step] of steps.entries()) {
            if (!reachable.has(step.id)) {
                continue;
            }
            for (const dependency of step.dependencies ?? []) {
                if (dominators.get(step.id)?.has(dependency)) {
                    continue;
                }
                const dependencyNode = graph.stepNode(dependency);
                findings.push(
                    context.findings.create({
                        code: "workflow.graph.unreachable-dependency",
                        message: `Dependency '${dependency}' is not reachable on all paths from firstNode to '${step.id}'`,
                        path: `/steps/${index}/dependencies`,
                        relatedLocations: dependencyNode
                            ? [
                                  {
                                      path: `/steps/${dependencyNode.index}/id`,
                                      message: "dependency step",
                                  },
                              ]
                            : undefined,
                        details: { step: step.id, dependency },
                    }),
                );
            }
        }
    }
}
