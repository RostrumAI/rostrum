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
    const inputNames = new Set(Object.keys(document.inputs ?? {}));

    document.steps.forEach((step, index) => {
      for (const [name, value] of Object.entries(step.inputs ?? {})) {
        if (!isReferenceObject(value)) continue;
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
    });

    return findings;
  }

  private checkReference(
    context: ValidationContext,
    graph: WorkflowGraph,
    inputNames: Set<string>,
    ref: string,
    pointer: string,
    consumer: ReferenceConsumer,
    findings: Finding[],
  ): void {
    if (ref.startsWith("inputs.")) {
      const name = ref.slice("inputs.".length);
      if (!inputNames.has(name)) {
        findings.push(
          context.findings.create({
            code: "workflow.reference.unknown-input",
            message: `Reference '${ref}' targets an undeclared workflow input`,
            path: pointer,
            details: { stepId: consumer.stepId, ref, input: name },
          }),
        );
      }
      return;
    }

    if (ref.startsWith("step.")) {
      const match = STEP_REF_PATTERN.exec(ref);
      const targetStepId = match?.[1];
      const outputName = match?.[2];
      if (!targetStepId || outputName === undefined) {
        findings.push(this.invalidSyntax(context, ref, pointer, consumer));
        return;
      }
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
            details: { stepId: consumer.stepId, ref, targetStep: targetStepId, output: outputName },
          }),
        );
      }
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
      if (
        targetStepId === consumer.stepId ||
        (consumer.isLoopStep && graph.loopBodyMembers(consumer.stepId).has(targetStepId)) ||
        !graph.completesBefore(targetStepId, consumer.stepId)
      ) {
        findings.push(
          context.findings.create({
            code: "workflow.reference.not-upstream",
            message: `Reference '${ref}' targets step '${targetStepId}' that does not complete before '${consumer.stepId}'`,
            path: pointer,
            details: { stepId: consumer.stepId, ref, targetStep: targetStepId },
          }),
        );
      }
      return;
    }

    if (ref.startsWith("loop.")) {
      const variable = ref.slice("loop.".length);
      const scope = graph.loopScopeFor(consumer.stepId);
      if (!scope || scope.variable !== variable) {
        findings.push(
          context.findings.create({
            code: "workflow.reference.loop-out-of-scope",
            message: `Loop variable '${ref}' is not in scope for step '${consumer.stepId}'`,
            path: pointer,
            details: { stepId: consumer.stepId, ref, available: scope?.variable ?? null },
          }),
        );
      }
      return;
    }

    findings.push(this.invalidSyntax(context, ref, pointer, consumer));
  }

  private invalidSyntax(
    context: ValidationContext,
    ref: string,
    pointer: string,
    consumer: ReferenceConsumer,
  ): Finding {
    return context.findings.create({
      code: "workflow.reference.invalid-syntax",
      message: `Reference '${ref}' does not start with 'inputs.', 'step.<stepId>.', or 'loop.'`,
      path: pointer,
      details: { stepId: consumer.stepId, ref },
    });
  }
}
