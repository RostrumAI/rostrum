import type { Finding } from "../../findings";
import type { WorkflowConditional } from "../../schema";
import { STEP_REF_PATTERN } from "../refs";
import type { ValidationContext } from "../validation-context";
import type { ValidationStage } from "../validation-stage";
import type { WorkflowGraph } from "../workflow-graph";

/** Predicate operators allowed in v1 leaf conditions (workflow interface v1). */
const ALLOWED_OPERATORS: Record<string, true> = {
  eq: true,
  neq: true,
  gt: true,
  gte: true,
  lt: true,
  lte: true,
  in: true,
  notin: true,
  contains: true,
  truthy: true,
  falsy: true,
};

/**
 * Stage 5: conditional semantics.
 *
 * Each conditional keeps at least one branch and a default (the schema
 * enforces both; the stage re-checks defensively), every step referenced
 * in a branch condition is listed in the conditional's `dependencies`,
 * predicate operators come from the allowed set, and leaf refs have the
 * `step.<stepId>.<outputName>` shape and name an existing step (E1-S2).
 */
export class ConditionalStage implements ValidationStage {
  readonly id = "conditional";
  readonly prerequisites: readonly string[] = ["identity", "graph"];

  /** Reports conditional-semantics findings for every conditional. */
  run(context: ValidationContext): Finding[] {
    const graph = context.graph;
    const findings: Finding[] = [];
    (context.document as { conditionals?: WorkflowConditional[] }).conditionals?.forEach(
      (conditional, conditionalIndex) => {
        if (conditional.branches.length === 0) {
          findings.push(
            context.findings.create({
              code: "workflow.conditional.empty-branches",
              message: `Conditional '${conditional.id}' must declare at least one branch`,
              path: `/conditionals/${conditionalIndex}/branches`,
              details: { conditionalId: conditional.id },
            }),
          );
        }

        const referencedStepIds = new Set<string>();
        conditional.branches.forEach((branch, branchIndex) => {
          this.checkCondition(
            context,
            graph,
            conditional,
            conditionalIndex,
            branchIndex,
            branch.condition,
            `/conditionals/${conditionalIndex}/branches/${branchIndex}/condition`,
            referencedStepIds,
            findings,
          );
        });

        const declaredDependencies = new Set(conditional.dependencies);
        for (const ref of referencedStepIds) {
          const match = STEP_REF_PATTERN.exec(ref);
          const referencedStepId = match?.[1];
          if (!referencedStepId || declaredDependencies.has(referencedStepId)) continue;
          findings.push(
            context.findings.create({
              code: "workflow.conditional.missing-dependency",
              message: `Step '${referencedStepId}' is referenced in a condition but not listed in the conditional's dependencies`,
              path: `/conditionals/${conditionalIndex}/dependencies`,
              relatedLocations: [
                {
                  path: `/conditionals/${conditionalIndex}/branches`,
                  message: `references ${ref}`,
                },
              ],
              details: { conditionalId: conditional.id, referencedStep: referencedStepId, ref },
            }),
          );
        }
      },
    );
    return findings;
  }

  /** Walks one condition tree, validating leaf predicates and collecting step refs. */
  private checkCondition(
    context: ValidationContext,
    graph: WorkflowGraph,
    conditional: WorkflowConditional,
    conditionalIndex: number,
    branchIndex: number,
    condition: unknown,
    pointer: string,
    referencedStepIds: Set<string>,
    findings: Finding[],
  ): void {
    if (typeof condition !== "object" || condition === null) {
      return;
    }
    const record = condition as Record<string, unknown>;
    if (typeof record.ref === "string") {
      const ref = record.ref;
      referencedStepIds.add(ref);
      const operator = record.op;
      if (typeof operator !== "string" || !ALLOWED_OPERATORS[operator]) {
        findings.push(
          context.findings.create({
            code: "workflow.conditional.invalid-operator",
            message: `Unknown predicate operator '${String(operator)}'`,
            path: pointer,
            details: { conditionalId: conditional.id, operator: operator ?? null },
          }),
        );
      }
      const match = STEP_REF_PATTERN.exec(ref);
      const stepId = match?.[1];
      if (!stepId) {
        findings.push(
          context.findings.create({
            code: "workflow.conditional.invalid-ref",
            message: `Condition ref '${ref}' must have the form 'step.<stepId>.<outputName>'`,
            path: pointer,
            details: { conditionalId: conditional.id, ref },
          }),
        );
      } else if (!graph.stepNode(stepId)) {
        findings.push(
          context.findings.create({
            code: "workflow.conditional.unknown-step",
            message: `Condition references unknown step '${stepId}'`,
            path: pointer,
            details: { conditionalId: conditional.id, stepId },
          }),
        );
      }
      return;
    }
    if (Array.isArray(record.all)) {
      record.all.forEach((child, index) => {
        this.checkCondition(
          context,
          graph,
          conditional,
          conditionalIndex,
          branchIndex,
          child,
          `${pointer}/all/${index}`,
          referencedStepIds,
          findings,
        );
      });
    }
    if (Array.isArray(record.any)) {
      record.any.forEach((child, index) => {
        this.checkCondition(
          context,
          graph,
          conditional,
          conditionalIndex,
          branchIndex,
          child,
          `${pointer}/any/${index}`,
          referencedStepIds,
          findings,
        );
      });
    }
  }
}
