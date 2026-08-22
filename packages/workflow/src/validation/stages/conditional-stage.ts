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

/** Composite keys whose values are arrays of nested conditions. */
const COMPOSITE_KEYS = ["all", "any"] as const;

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

        // For each declared conditional, in document order:
        // 1. Defensively report an empty branches list; the schema also requires one.
        // 2. Walk every branch's condition tree, collecting the step refs leaves mention.
        // 3. Report refs whose step is missing from the conditional's dependencies.
        const conditionals = context.typedDocument.conditionals ?? [];
        for (const [conditionalIndex, conditional] of conditionals.entries()) {
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
            for (const [branchIndex, branch] of conditional.branches.entries()) {
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
            }

            // A ref may repeat across branches; the set deduplicates so each
            // missing dependency is reported once per conditional.
            const declaredDependencies = new Set(conditional.dependencies);
            for (const ref of referencedStepIds) {
                if (this.declaredStep(ref, declaredDependencies)) {
                    continue;
                }
                findings.push(
                    this.missingDependencyFinding(context, conditional, conditionalIndex, ref),
                );
            }
        }
        return findings;
    }

    /**
     * Checks whether a condition ref names a declared dependency step.
     *
     * Refs that fail the `step.<stepId>.<outputName>` shape return false
     * here; shape problems are reported separately as invalid-ref
     * findings, not as missing dependencies.
     */
    private declaredStep(ref: string, declaredDependencies: Set<string>): boolean {
        const match = STEP_REF_PATTERN.exec(ref);
        const stepId = match?.[1];
        if (!stepId) {
            return false;
        }
        return declaredDependencies.has(stepId);
    }

    /** Builds the finding for a condition ref missing from the dependencies list. */
    private missingDependencyFinding(
        context: ValidationContext,
        conditional: WorkflowConditional,
        conditionalIndex: number,
        ref: string,
    ): Finding {
        const match = STEP_REF_PATTERN.exec(ref);
        const referencedStepId = match?.[1] ?? "";
        return context.findings.create({
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
        });
    }

    /**
     * Walks one condition tree, validating leaves and collecting step refs.
     *
     * A leaf carries `ref` and is checked by {@link checkLeaf}; a
     * composite carries `all` or `any` and recurses into its children.
     * Values that are neither are ignored here because the schema stage
     * already rejects malformed conditions.
     */
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
        // Parsed JSON arrives untyped; the guard above proves this is an
        // object, and the cast only unlocks property access for dispatch.
        const record = condition as Record<string, unknown>;

        if (typeof record.ref === "string") {
            this.checkLeaf(
                context,
                graph,
                conditional,
                record.ref,
                record.op,
                pointer,
                referencedStepIds,
                findings,
            );
            return;
        }
        for (const key of COMPOSITE_KEYS) {
            const children = record[key];
            if (!Array.isArray(children)) {
                continue;
            }
            if (children.length === 0) {
                findings.push(
                    context.findings.create({
                        code: "workflow.conditional.empty-group",
                        message: `Condition group '${key}' must declare at least one nested condition`,
                        path: `${pointer}/${key}`,
                        details: { conditionalId: conditional.id },
                    }),
                );
                continue;
            }
            children.forEach((child, index) => {
                this.checkCondition(
                    context,
                    graph,
                    conditional,
                    conditionalIndex,
                    branchIndex,
                    child,
                    `${pointer}/${key}/${index}`,
                    referencedStepIds,
                    findings,
                );
            });
        }
    }

    /** Validates one leaf predicate: operator membership plus ref shape and target step. */
    private checkLeaf(
        context: ValidationContext,
        graph: WorkflowGraph,
        conditional: WorkflowConditional,
        leafRef: string,
        operator: unknown,
        pointer: string,
        referencedStepIds: Set<string>,
        findings: Finding[],
    ): void {
        referencedStepIds.add(leafRef);

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

        // A well-shaped ref must name a step the graph knows; a malformed
        // one is reported once here and skipped in the dependency pass.
        const match = STEP_REF_PATTERN.exec(leafRef);
        const stepId = match?.[1];
        if (!stepId) {
            findings.push(
                context.findings.create({
                    code: "workflow.conditional.invalid-ref",
                    message: `Condition ref '${leafRef}' must have the form 'step.<stepId>.<outputName>'`,
                    path: pointer,
                    details: { conditionalId: conditional.id, ref: leafRef },
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
    }
}
