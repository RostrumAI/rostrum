import { Type } from "typebox";
import { WorkflowDocument } from "../schema";
import { CompatibilityStage } from "../validation/stages/compatibility-stage";
import { ConditionalStage } from "../validation/stages/conditional-stage";
import { GraphStage } from "../validation/stages/graph-stage";
import { IdentityStage } from "../validation/stages/identity-stage";
import { ReferencesStage } from "../validation/stages/references-stage";
import { ShapeStage } from "../validation/stages/shape-stage";
import { TerminationStage } from "../validation/stages/termination-stage";
import type { InterfaceRuleSet } from "./interface-rule-set";
import { StepTypeRegistry } from "./step-type-registry";

/**
 * The workflow interface v1 rule set.
 *
 * The rule set is frozen: every future release ships it forward
 * unchanged, so a v1 document keeps validating identically forever
 * (E1-S1, E1-S4). It carries the document schema, the demonstrative
 * step-type registry (`task` requires an `operation` in its config;
 * `result` accepts any config object), the metadata members the digest
 * excludes per E1-S4's field classification, and stages 2 through 8 of
 * the validation pipeline. Stage 0 (parse) and stage 1 (version
 * selection) are version-independent and run before the rule set's
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
export const V1_RULE_SET: InterfaceRuleSet = Object.freeze({
    version: "v1",
    documentSchema: WorkflowDocument,
    stepTypes,
    metadataMembers: Object.freeze(["name", "description"]),
    stages: Object.freeze([
        new ShapeStage(WorkflowDocument),
        new IdentityStage(stepTypes),
        new GraphStage(),
        new ConditionalStage(),
        new TerminationStage(),
        new ReferencesStage(),
        new CompatibilityStage(),
    ]),
});
