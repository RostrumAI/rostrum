import { Compile, type Validator } from "typebox/compile";
import type { Finding } from "../../findings";
import type { StepTypeRegistry } from "../../rules/step-type-registry";
import type { WorkflowDocument, WorkflowStep } from "../../schema";
import type { ValidationContext } from "../validation-context";
import type { ValidationStage } from "../validation-stage";

/**
 * Stage 3: identity and reference integrity.
 *
 * Step and conditional ids must be unique, `firstNode` and every
 * `successors`, `dependencies`, `loop.body`, `branches[].next`, and
 * `default.next` entry must reference an existing step, and a step's
 * `conditional` must reference an existing conditional. The stage also
 * owns the registry rules the schema cannot express: `type` must be
 * registered for the selected interface version, a step carries at most
 * one of `successors`/`conditional` and of `loop`/`conditional`, and a
 * present `config` validates against the registered config schema
 * (E1-S2).
 */
export class IdentityStage implements ValidationStage {
  readonly id = "identity";
  readonly prerequisites: readonly string[] = ["shape"];

  private readonly stepTypes: StepTypeRegistry;
  private readonly configValidators = new Map<string, Validator>();

  /** Constructs the stage and compiles one config validator per registered type. */
  constructor(stepTypes: StepTypeRegistry) {
    this.stepTypes = stepTypes;
    for (const type of stepTypes.types()) {
      const schema = stepTypes.registrationFor(type)?.configSchema;
      if (schema) {
        this.configValidators.set(type, Compile(schema));
      }
    }
  }

  /**
   * Reports identity, reference, registry, and config findings.
   *
   * The walk runs in three passes so order never hides a problem:
   * 1. Index the first occurrence of every step and conditional id.
   * 2. Check each step (duplicates, registry rules, outgoing targets).
   * 3. Check firstNode and each conditional's branch targets.
   */
  run(context: ValidationContext): Finding[] {
    const document = context.typedDocument;
    const findings: Finding[] = [];
    const firstStepIndexById = new Map<string, number>();
    for (const [index, step] of document.steps.entries()) {
      if (!firstStepIndexById.has(step.id)) {
        firstStepIndexById.set(step.id, index);
      }
    }
    const firstConditionalIndexById = new Map<string, number>();
    for (const [index, conditional] of (document.conditionals ?? []).entries()) {
      if (!firstConditionalIndexById.has(conditional.id)) {
        firstConditionalIndexById.set(conditional.id, index);
      }
    }

    for (const [index, step] of document.steps.entries()) {
      this.checkStep(context, document, step, index, firstStepIndexById, findings);
    }

    if (!firstStepIndexById.has(document.firstNode)) {
      findings.push(
        context.findings.create({
          code: "workflow.identity.first-node-unknown",
          message: `firstNode '${document.firstNode}' does not reference an existing step`,
          path: "/firstNode",
          details: { firstNode: document.firstNode },
        }),
      );
    }

    for (const [index, conditional] of (document.conditionals ?? []).entries()) {
      this.checkConditional(context, conditional, index, firstConditionalIndexById, firstStepIndexById, findings);
    }

    return findings;
  }

  /** Reports duplicate ids and unknown branch targets for one conditional. */
  private checkConditional(
    context: ValidationContext,
    conditional: NonNullable<WorkflowDocument["conditionals"]>[number],
    index: number,
    firstConditionalIndexById: Map<string, number>,
    firstStepIndexById: Map<string, number>,
    findings: Finding[],
  ): void {
    // A duplicated id is reported at every occurrence after the first,
    // with a related location pointing back at that first occurrence.
    const firstIndex = firstConditionalIndexById.get(conditional.id);
    if (firstIndex !== undefined && firstIndex !== index) {
      findings.push(
        context.findings.create({
          code: "workflow.identity.duplicate-conditional-id",
          message: `Duplicate conditional id '${conditional.id}'`,
          path: `/conditionals/${index}/id`,
          relatedLocations: [{ path: `/conditionals/${firstIndex}/id`, message: "first occurrence" }],
          details: { duplicateId: conditional.id },
        }),
      );
    }

    for (const [branchIndex, branch] of conditional.branches.entries()) {
      if (branch.next && !firstStepIndexById.has(branch.next)) {
        findings.push(
          context.findings.create({
            code: "workflow.reference.unknown-target",
            message: `branches[${branchIndex}].next '${branch.next}' does not reference an existing step`,
            path: `/conditionals/${index}/branches/${branchIndex}/next`,
            details: {
              conditionalId: conditional.id,
              target: branch.next,
              field: "branches.next",
            },
          }),
        );
      }
    }
    if (conditional.default.next && !firstStepIndexById.has(conditional.default.next)) {
      findings.push(
        context.findings.create({
          code: "workflow.reference.unknown-target",
          message: `default.next '${conditional.default.next}' does not reference an existing step`,
          path: `/conditionals/${index}/default/next`,
          details: {
            conditionalId: conditional.id,
            target: conditional.default.next,
            field: "default.next",
          },
        }),
      );
    }
  }

  /** Reports identity, registry, exclusivity, and target problems for one step. */
  private checkStep(
    context: ValidationContext,
    document: WorkflowDocument,
    step: WorkflowStep,
    index: number,
    firstStepIndexById: Map<string, number>,
    findings: Finding[],
  ): void {
    const firstIndex = firstStepIndexById.get(step.id);
    if (firstIndex !== undefined && firstIndex !== index) {
      findings.push(
        context.findings.create({
          code: "workflow.identity.duplicate-step-id",
          message: `Duplicate step id '${step.id}'`,
          path: `/steps/${index}/id`,
          relatedLocations: [{ path: `/steps/${firstIndex}/id`, message: "first occurrence" }],
          details: { duplicateId: step.id },
        }),
      );
    }

    // Config validation needs the type's registered schema, so it runs
    // only when the type is known; unknown types are reported above.
    if (!this.stepTypes.has(step.type)) {
      findings.push(
        context.findings.create({
          code: "workflow.step.unknown-type",
          message: `Unknown step type '${step.type}'`,
          path: `/steps/${index}/type`,
          details: { stepId: step.id, received: step.type, supported: this.stepTypes.types() },
        }),
      );
    } else {
      this.checkConfig(context, step, index, findings);
    }

    // v1 routing is either linear or conditional, and conditionals own
    // their looping; these pairs cannot coexist on one step.
    if (step.successors && step.conditional) {
      findings.push(this.mutuallyExclusive(context, step, index, "successors", "conditional"));
    }
    if (step.loop && step.conditional) {
      findings.push(this.mutuallyExclusive(context, step, index, "loop", "conditional"));
    }

    for (const [targetIndex, target] of (step.successors ?? []).entries()) {
      if (!firstStepIndexById.has(target)) {
        findings.push(
          this.unknownTarget(
            context,
            step,
            `/steps/${index}/successors/${targetIndex}`,
            target,
            "successors",
          ),
        );
      }
    }
    for (const [targetIndex, target] of (step.dependencies ?? []).entries()) {
      if (!firstStepIndexById.has(target)) {
        findings.push(
          this.unknownTarget(
            context,
            step,
            `/steps/${index}/dependencies/${targetIndex}`,
            target,
            "dependencies",
          ),
        );
      }
    }
    if (step.loop && !firstStepIndexById.has(step.loop.body)) {
      findings.push(
        this.unknownTarget(context, step, `/steps/${index}/loop/body`, step.loop.body, "loop.body"),
      );
    }
    if (
      step.conditional &&
      !(document.conditionals ?? []).some((conditional) => conditional.id === step.conditional)
    ) {
      findings.push(
        context.findings.create({
          code: "workflow.reference.unknown-target",
          message: `conditional '${step.conditional}' does not reference an existing conditional`,
          path: `/steps/${index}/conditional`,
          details: { stepId: step.id, target: step.conditional, field: "conditional" },
        }),
      );
    }
  }

  /** Validates a present `config` against its step type's compiled config schema. */
  private checkConfig(
    context: ValidationContext,
    step: WorkflowStep,
    index: number,
    findings: Finding[],
  ): void {
    if (step.config === undefined) {
      return;
    }
    const compiled = this.configValidators.get(step.type);
    if (!compiled) {
      return;
    }
    for (const error of compiled.Errors(step.config)) {
      findings.push(
        context.findings.create({
          code: "workflow.step.invalid-config",
          message: `Invalid config for step type '${step.type}': ${error.message}`,
          path: `/steps/${index}/config`,
          details: {
            stepId: step.id,
            type: step.type,
            schemaPath: error.schemaPath,
            keyword: error.keyword,
            params: error.params as Record<string, unknown>,
          },
        }),
      );
    }
  }

  /** Builds the finding for two fields that v1 forbids declaring together. */
  private mutuallyExclusive(
    context: ValidationContext,
    step: WorkflowStep,
    index: number,
    firstField: string,
    secondField: string,
  ): Finding {
    return context.findings.create({
      code: "workflow.shape.mutually-exclusive",
      message: `Step '${step.id}' cannot declare both ${firstField} and ${secondField}`,
      path: `/steps/${index}`,
      details: { stepId: step.id, fields: [firstField, secondField] },
    });
  }

  /** Builds the shared finding for a step-targeting field naming no known step. */
  private unknownTarget(
    context: ValidationContext,
    step: WorkflowStep,
    path: string,
    target: string,
    field: string,
  ): Finding {
    return context.findings.create({
      code: "workflow.reference.unknown-target",
      message: `${field} '${target}' does not reference an existing step`,
      path,
      details: { stepId: step.id, target, field },
    });
  }
}
