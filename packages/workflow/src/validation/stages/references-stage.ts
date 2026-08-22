import type { Finding } from "../../findings";
import { escapePointerToken } from "../../source-map";
import { isReferenceObject, LOOP_RESULTS_OUTPUT, STEP_REF_PATTERN } from "../refs";
import type { ValidationContext } from "../validation-context";
import type { ValidationStage } from "../validation-stage";
import type { WorkflowGraph } from "../workflow-graph";

/** One consumer location a reference is checked against. */
interface ReferenceConsumer {
    /** Id of the step that consumes the reference. */
    stepId: string;
    /** True when the consumer declares a `loop`. */
    isLoopStep: boolean;
    /** True when the reference is the loop's `collection`, which may name the loop step itself. */
    isCollection: boolean;
}

/**
 * Stage 7: data references.
 *
 * Every binding value with the exact shape `{ "ref": "<path>" }` must be
 * syntactically valid and resolve: `inputs.<name>` to a declared
 * workflow input, `step.<id>.<outputName>` to a declared output of an
 * existing step, or `loop.<variable>` to the variable of the enclosing
 * loop body. A producer must also complete before its consumer; loop
 * collections may name the loop step itself, whose handler runs before
 * iteration begins (E1-S2). A ref to a loop step also resolves to the
 * reserved `results` output — the array of collected iteration results.
 */
export class ReferencesStage implements ValidationStage {
    readonly id = "references";
    readonly prerequisites: readonly string[] = ["identity", "graph"];

    /** Reports invalid syntax, unresolvable, and out-of-order references. */
    run(context: ValidationContext): Finding[] {
        const graph = context.graph;
        const document = graph.document;
        const findings: Finding[] = [];
        // Workflow inputs are declared once at the top level; every step's
        // `inputs.*` refs resolve against this set.
        const inputNames = new Set(Object.keys(document.inputs ?? {}));

        for (const [index, step] of document.steps.entries()) {
            for (const [name, value] of Object.entries(step.inputs ?? {})) {
                if (!isReferenceObject(value)) {
                    continue;
                }
                this.checkReference(
                    context,
                    graph,
                    inputNames,
                    value.ref,
                    `/steps/${index}/inputs/${escapePointerToken(name)}`,
                    { stepId: step.id, isLoopStep: step.loop !== undefined, isCollection: false },
                    findings,
                );
            }
            // A loop's collection is checked separately because it may name
            // the loop step itself and follows the completes-before-iteration
            // ordering rule instead of completes-before-consumer.
            if (step.loop && isReferenceObject(step.loop.collection)) {
                this.checkReference(
                    context,
                    graph,
                    inputNames,
                    step.loop.collection.ref,
                    `/steps/${index}/loop/collection`,
                    { stepId: step.id, isLoopStep: true, isCollection: true },
                    findings,
                );
            }
        }

        return findings;
    }

    /**
     * Resolves one reference against the document and reports problems.
     *
     * The first segment selects the namespace — `inputs`, `step`, or
     * `loop` — and each namespace has its own resolution and ordering
     * rules; anything else is a syntax finding.
     */
    private checkReference(
        context: ValidationContext,
        graph: WorkflowGraph,
        inputNames: Set<string>,
        ref: string,
        pointer: string,
        consumer: ReferenceConsumer,
        findings: Finding[],
    ): void {
        const separator = ref.indexOf(".");
        const namespace = separator === -1 ? ref : ref.slice(0, separator);
        switch (namespace) {
            case "inputs":
                this.checkInputRef(context, inputNames, ref, pointer, consumer, findings);
                return;
            case "step":
                this.checkStepRef(graph, context, ref, pointer, consumer, findings);
                return;
            case "loop":
                this.checkLoopRef(graph, context, ref, pointer, consumer, findings);
                return;
            default:
                findings.push(this.invalidSyntax(context, ref, pointer, consumer));
        }
    }

    /** Reports an `inputs.<name>` reference that names no declared workflow input. */
    private checkInputRef(
        context: ValidationContext,
        inputNames: Set<string>,
        ref: string,
        pointer: string,
        consumer: ReferenceConsumer,
        findings: Finding[],
    ): void {
        const name = ref.slice("inputs.".length);
        if (inputNames.has(name)) {
            return;
        }
        findings.push(
            context.findings.create({
                code: "workflow.reference.unknown-input",
                message: `Reference '${ref}' targets an undeclared workflow input`,
                path: pointer,
                details: { stepId: consumer.stepId, ref, input: name },
            }),
        );
    }

    /**
     * Resolves a `step.<stepId>.<outputName>` reference in two passes:
     *
     * 1. Resolution — the target step must exist, and the named output
     *    must be declared on it (the reserved `results` output counts for
     *    loop steps).
     * 2. Ordering — collections may only name steps that complete before
     *    iteration begins; ordinary references must come from upstream:
     *    not from the consumer itself, not from inside its own loop body,
     *    and only from steps that complete before the consumer runs.
     */
    private checkStepRef(
        graph: WorkflowGraph,
        context: ValidationContext,
        ref: string,
        pointer: string,
        consumer: ReferenceConsumer,
        findings: Finding[],
    ): void {
        // Pass 1, shape: the ref must split into a step id and an output
        // name; anything else is reported once as a syntax problem.
        const match = STEP_REF_PATTERN.exec(ref);
        const targetStepId = match?.[1];
        const outputName = match?.[2];
        if (!targetStepId || outputName === undefined) {
            findings.push(this.invalidSyntax(context, ref, pointer, consumer));
            return;
        }
        // Pass 1, resolution: the target step must exist.
        const source = graph.stepNode(targetStepId);
        if (!source) {
            findings.push(
                context.findings.create({
                    code: "workflow.reference.unknown-step",
                    message: `Reference '${ref}' targets unknown step '${targetStepId}'`,
                    path: pointer,
                    details: { stepId: consumer.stepId, ref, targetStep: targetStepId },
                }),
            );
            return;
        }
        // Pass 1, resolution: the named output must be declared on the
        // target step. Loop steps additionally expose the reserved
        // `results` collection without declaring it.
        const declaredOutputs = Object.keys(source.step.outputs ?? {});
        const resolves =
            declaredOutputs.includes(outputName) ||
            (source.step.loop !== undefined && outputName === LOOP_RESULTS_OUTPUT);
        if (!resolves) {
            findings.push(
                context.findings.create({
                    code: "workflow.reference.unknown-output",
                    message: `Reference '${ref}' targets undeclared output '${outputName}'`,
                    path: pointer,
                    details: {
                        stepId: consumer.stepId,
                        ref,
                        targetStep: targetStepId,
                        output: outputName,
                    },
                }),
            );
        }

        // Pass 2, collections: naming the loop step itself is allowed (the
        // handler runs before iteration begins); every other producer must
        // finish before iteration starts, not merely before the loop step's
        // successors run.
        if (consumer.isCollection) {
            if (
                targetStepId !== consumer.stepId &&
                !graph.completesBeforeIteration(targetStepId, consumer.stepId)
            ) {
                findings.push(
                    context.findings.create({
                        code: "workflow.reference.not-upstream",
                        message: `Loop collection '${ref}' targets step '${targetStepId}' that does not complete before iteration begins`,
                        path: pointer,
                        details: { stepId: consumer.stepId, ref, targetStep: targetStepId },
                    }),
                );
            }
            return;
        }

        // Pass 2, ordinary references: the producer must be upstream of the
        // consumer — not the consumer itself, not a member of its own loop
        // body, and causally ordered before it.
        const upstream =
            targetStepId !== consumer.stepId &&
            !(consumer.isLoopStep && graph.loopBodyMembers(consumer.stepId).has(targetStepId)) &&
            graph.completesBefore(targetStepId, consumer.stepId);
        if (!upstream) {
            findings.push(
                context.findings.create({
                    code: "workflow.reference.not-upstream",
                    message: `Reference '${ref}' targets step '${targetStepId}' that does not complete before '${consumer.stepId}'`,
                    path: pointer,
                    details: { stepId: consumer.stepId, ref, targetStep: targetStepId },
                }),
            );
        }
    }

    /** Reports a `loop.<variable>` reference whose variable is not in the enclosing scope. */
    private checkLoopRef(
        graph: WorkflowGraph,
        context: ValidationContext,
        ref: string,
        pointer: string,
        consumer: ReferenceConsumer,
        findings: Finding[],
    ): void {
        const variable = ref.slice("loop.".length);
        const scope = graph.loopScopeFor(consumer.stepId);
        if (scope && scope.variable === variable) {
            return;
        }
        findings.push(
            context.findings.create({
                code: "workflow.reference.loop-out-of-scope",
                message: `Loop variable '${ref}' is not in scope for step '${consumer.stepId}'`,
                path: pointer,
                details: { stepId: consumer.stepId, ref, available: scope?.variable ?? null },
            }),
        );
    }

    /** Builds the syntax finding for a ref outside all supported namespaces or shapes. */
    private invalidSyntax(
        context: ValidationContext,
        ref: string,
        pointer: string,
        consumer: ReferenceConsumer,
    ): Finding {
        return context.findings.create({
            code: "workflow.reference.invalid-syntax",
            message: `Reference '${ref}' must be 'inputs.<name>', 'step.<stepId>.<outputName>', or 'loop.<variable>'`,
            path: pointer,
            details: { stepId: consumer.stepId, ref },
        });
    }
}
