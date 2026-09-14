import { Type } from "typebox";
import { WorkflowDocumentSchema } from "../schema";
import { ConditionalStage } from "../validation/stages/conditional-stage";
import { GraphStage } from "../validation/stages/graph-stage";
import { IdentityAndReferencesStage } from "../validation/stages/identity-and-references-stage";
import { InputOutputCompatibilityStage } from "../validation/stages/input-output-compatibility-stage";
import { ReferencesStage } from "../validation/stages/references-stage";
import { ShapeStage } from "../validation/stages/shape-stage";
import { TerminationStage } from "../validation/stages/termination-stage";
import { StepTypeRegistry } from "./step-type-registry";
import type { WorkflowFormatRuleSet } from "./workflow-format-rule-set";

/**
 * The workflow format v1 rule set.
 *
 * The rule set is frozen: every future release ships it forward
 * unchanged, so a v1 document keeps validating identically forever.
 * It carries the document schema, the demonstrative step-type registry
 * (`task` requires an `operation` in its config; `result` accepts any
 * config object), the metadata members the digest excludes, and stages
 * 2 through 8 of the validation pipeline. Stage 0 (parse) and stage 1 (format
 * selection) are format-version-independent and run before the rule set's
 * stages.
 */

const stepTypes = new StepTypeRegistry({
    task: {
        configSchema: Type.Object({ operation: Type.String() }, { additionalProperties: true }),
    },
    result: {},
});
stepTypes.seal();

/** The frozen v1 rule set: schema, step types, metadata members, and validation stages. */
export const V1_WORKFLOW_FORMAT_RULE_SET: WorkflowFormatRuleSet = Object.freeze({
    version: "v1",
    documentSchema: WorkflowDocumentSchema,
    stepTypes,
    metadataMembers: Object.freeze(["name", "description"]),
    stages: Object.freeze([
        new ShapeStage(WorkflowDocumentSchema),
        new IdentityAndReferencesStage(stepTypes),
        new GraphStage(),
        new ConditionalStage(),
        new TerminationStage(),
        new ReferencesStage(),
        new InputOutputCompatibilityStage(),
    ]),
});
