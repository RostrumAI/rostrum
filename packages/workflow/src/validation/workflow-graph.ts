import type { WorkflowConditional, WorkflowDocument, WorkflowStep } from "../schema";

/** One step together with its index in the document's `steps` array. */
export interface StepNode {
  readonly step: WorkflowStep;
  readonly index: number;
}

/** One conditional together with its index in the document's `conditionals` array. */
export interface ConditionalNode {
  readonly conditional: WorkflowConditional;
  readonly index: number;
}

/**
 * Finds one cycle in a directed graph and returns it as a step-id path, or
 * null when the graph is acyclic. The path repeats the entry node so the
 * cycle reads as a closed loop.
 */
function findCycleIn(edges: Map<string, string[]>, startNodes: Iterable<string>): string[] | null {
  // White/grey/black coloring: IN_PROGRESS marks the current DFS path, so
  // an edge back into it closes a cycle.
  const IN_PROGRESS = 1;
  const DONE = 2;
  const color = new Map<string, number>();
  const path: string[] = [];
  let cycle: string[] | null = null;
  const visit = (nodeId: string): boolean => {
    // Mark the node as on the current DFS path, then descend into
    // unvisited successors. An edge to an IN_PROGRESS node is a back
    // edge: the cycle is the slice of the path from that node onward,
    // closed by repeating the entry id.
    color.set(nodeId, IN_PROGRESS);
    path.push(nodeId);
    for (const next of edges.get(nodeId) ?? []) {
      const state = color.get(next);
      if (state === IN_PROGRESS) {
        // The cycle is the slice of the current path from the entry
        // node onward; repeating the entry id closes the loop.
        cycle = path.slice(path.indexOf(next)).concat(next);
        return true;
      }
      if (state === undefined && visit(next)) {
        return true;
      }
    }
    color.set(nodeId, DONE);
    path.pop();
    return false;
  };
  for (const start of startNodes) {
    if (color.get(start) === undefined && visit(start)) {
      break;
    }
  }
  return cycle;
}

/**
 * The document model shared by the graph, conditional, termination, and
 * reference stages.
 *
 * The graph resolves identifiers once and derives the edge sets the
 * stages need: control-flow edges (`successors`, branch and default
 * `next`, loop body entries), causal edges that add dependency and
 * loop-iteration ordering, loop body membership, and dominator sets for
 * the merge-after-branch restriction. Stages only run when the identity
 * stage passed, so every id resolves.
 */
export class WorkflowGraph {
  readonly document: WorkflowDocument;

  private readonly stepsById = new Map<string, StepNode>();
  private readonly conditionalsById = new Map<string, ConditionalNode>();
  private readonly loopBodyCache = new Map<string, Set<string>>();
  private controlEdgeCache: Map<string, string[]> | null = null;

  /** Builds the graph over a shape-valid document. */
  constructor(document: WorkflowDocument) {
    this.document = document;
    for (const [index, step] of document.steps.entries()) {
      this.stepsById.set(step.id, { step, index });
    }
    for (const [index, conditional] of (document.conditionals ?? []).entries()) {
      this.conditionalsById.set(conditional.id, { conditional, index });
    }
  }

  /** Gets a step node by step id, or undefined when absent. */
  stepNode(stepId: string): StepNode | undefined {
    return this.stepsById.get(stepId);
  }

  /** Gets a conditional node by conditional id, or undefined when absent. */
  conditionalNode(conditionalId: string): ConditionalNode | undefined {
    return this.conditionalsById.get(conditionalId);
  }

  /** Resolves the conditional a step routes through, or undefined when the step has none. */
  conditionalForStep(stepId: string): WorkflowConditional | undefined {
    const conditionalId = this.stepsById.get(stepId)?.step.conditional;
    if (!conditionalId) {
      return undefined;
    }
    return this.conditionalsById.get(conditionalId)?.conditional;
  }

  /**
   * Control-flow edges: `successors`, branch and default `next` targets,
   * and each loop step's body entry. Cycle detection and dominator
   * analysis run over this set.
   */
  controlEdges(): Map<string, string[]> {
    if (this.controlEdgeCache) {
      return this.controlEdgeCache;
    }
    const edges = new Map<string, string[]>();
    for (const node of this.stepsById.values()) {
      const targets = [...(node.step.successors ?? [])];
      const conditional = this.conditionalForStep(node.step.id);
      if (conditional) {
        for (const branch of conditional.branches) {
          if (branch.next) {
            targets.push(branch.next);
          }
        }
        if (conditional.default.next) {
          targets.push(conditional.default.next);
        }
      }
      if (node.step.loop) {
        targets.push(node.step.loop.body);
      }
      edges.set(node.step.id, targets);
    }
    this.controlEdgeCache = edges;
    return edges;
  }

  /**
   * Ordering edges: control-flow edges plus dependency edges
   * (dependency → dependent). With `includeLoopFeeds`, also adds each
   * loop body member → its loop step, so downstream steps can consume
   * iteration outputs.
   */
  orderingEdges(includeLoopFeeds: boolean): Map<string, string[]> {
    const edges = new Map<string, string[]>();
    for (const [stepId, targets] of this.controlEdges()) {
      edges.set(stepId, [...targets]);
    }
    for (const node of this.stepsById.values()) {
      for (const dependency of node.step.dependencies ?? []) {
        const targets = edges.get(dependency) ?? [];
        targets.push(node.step.id);
        edges.set(dependency, targets);
      }
    }
    if (includeLoopFeeds) {
      for (const node of this.stepsById.values()) {
        if (!node.step.loop) {
          continue;
        }
        for (const memberId of this.loopBodyMembers(node.step.id)) {
          const targets = edges.get(memberId) ?? [];
          targets.push(node.step.id);
          edges.set(memberId, targets);
        }
      }
    }
    return edges;
  }

  /**
   * True when the producer step completes before the consumer step
   * starts: a causal path runs producer → consumer through successors,
   * selected branches, loop bodies, dependencies, or iteration results
   * feeding the loop step's successors.
   */
  completesBefore(producerId: string, consumerId: string): boolean {
    return this.reachableFrom(producerId, this.orderingEdges(true)).has(consumerId);
  }

  /**
   * True when the producer completes before a loop step's iteration
   * begins: the producer is the loop step itself (its handler output may
   * seed the collection) or a causal predecessor outside the loop body.
   */
  completesBeforeIteration(producerId: string, loopStepId: string): boolean {
    if (producerId === loopStepId) {
      return true;
    }
    return this.reachableFrom(producerId, this.orderingEdges(false)).has(loopStepId);
  }

  /** Steps reachable from `firstNode` over control-flow edges. */
  controlReachableFromFirstNode(): Set<string> {
    return this.reachableFrom(this.document.firstNode, this.controlEdges());
  }

  /** The body subgraph of one loop: everything control-reachable from `loop.body`. */
  loopBodyMembers(loopStepId: string): Set<string> {
    const cached = this.loopBodyCache.get(loopStepId);
    if (cached) {
      return cached;
    }
    const body = this.stepsById.get(loopStepId)?.step.loop?.body;
    const members = body ? this.reachableFrom(body, this.controlEdges()) : new Set<string>();
    this.loopBodyCache.set(loopStepId, members);
    return members;
  }

  /** True when the step belongs to any loop body. */
  isInAnyLoopBody(stepId: string): boolean {
    for (const node of this.stepsById.values()) {
      if (node.step.loop && this.loopBodyMembers(node.step.id).has(stepId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * The loop enclosing a body step, for `loop.<variable>` scope checks.
   * When loops share body steps, the first loop in document order wins.
   */
  loopScopeFor(stepId: string): { loopStepId: string; variable: string } | undefined {
    for (const node of this.stepsById.values()) {
      if (node.step.loop && this.loopBodyMembers(node.step.id).has(stepId)) {
        return { loopStepId: node.step.id, variable: node.step.loop.variable };
      }
    }
    return undefined;
  }

  /** Finds one cycle in the top-level control graph, or null when it is acyclic. */
  findCycle(): string[] | null {
    return findCycleIn(this.controlEdges(), this.stepsById.keys());
  }

  /** Finds one cycle inside a loop body subgraph, or null when the body is acyclic. */
  findBodyCycle(loopStepId: string): string[] | null {
    const members = this.loopBodyMembers(loopStepId);
    const edges = new Map<string, string[]>();
    for (const memberId of members) {
      const targets = (this.controlEdges().get(memberId) ?? []).filter((target) =>
        members.has(target),
      );
      edges.set(memberId, targets);
    }
    return findCycleIn(edges, members);
  }

  /**
   * Computes dominator sets over the control-flow graph, restricted to
   * steps reachable from `firstNode`. For each reachable step, the set
   * holds the steps that lie on every control-flow path from
   * `firstNode` — the merge-after-branch test for dependencies. Run
   * only after cycle detection reports no cycle, so the dataflow
   * terminates.
   */
  dominators(): Map<string, Set<string>> {
    const reachable = this.controlReachableFromFirstNode();
    const predecessors = new Map<string, string[]>();
    for (const stepId of reachable) {
      predecessors.set(stepId, []);
    }
    for (const [from, targets] of this.controlEdges()) {
      if (!reachable.has(from)) {
        continue;
      }
      for (const target of targets) {
        if (!reachable.has(target)) {
          continue;
        }
        predecessors.get(target)?.push(from);
      }
    }
    // Iterative dataflow: every node starts dominating everything except
    // the entry; each pass intersects predecessor sets until nothing changes.
    const dominators = new Map<string, Set<string>>();
    for (const stepId of reachable) {
      dominators.set(
        stepId,
        stepId === this.document.firstNode ? new Set([stepId]) : new Set(reachable),
      );
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const stepId of reachable) {
        if (stepId === this.document.firstNode) {
          continue;
        }
        const predDominatorSets: Set<string>[] = [];
        for (const predecessor of predecessors.get(stepId) ?? []) {
          const set = dominators.get(predecessor);
          if (set) {
            predDominatorSets.push(set);
          }
        }
        if (predDominatorSets.length === 0) {
          continue;
        }
        // The new dominator set is the intersection of every
        // predecessor's set — the steps all paths share — plus the node
        // itself, which trivially dominates itself.
        let intersection = new Set(predDominatorSets[0]);
        for (const other of predDominatorSets.slice(1)) {
          intersection = new Set([...intersection].filter((id) => other.has(id)));
        }
        intersection.add(stepId);
        const current = dominators.get(stepId);
        if (
          current &&
          (current.size !== intersection.size || [...intersection].some((id) => !current.has(id)))
        ) {
          dominators.set(stepId, intersection);
          changed = true;
        }
      }
    }
    return dominators;
  }

  /**
   * Collects every id reachable from `startId` over `edges` by iterative
   * depth-first traversal.
   */
  private reachableFrom(startId: string, edges: Map<string, string[]>): Set<string> {
    const seen = new Set<string>();
    const stack = [startId];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || seen.has(current)) {
        continue;
      }
      seen.add(current);
      for (const next of edges.get(current) ?? []) {
        if (!seen.has(next)) {
          stack.push(next);
        }
      }
    }
    return seen;
  }
}
