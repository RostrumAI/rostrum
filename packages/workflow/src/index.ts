/**
 * Entry point of the shared workflow package.
 *
 * The package implements workflow interface v1 for every consumer —
 * Control API, daemon, conformance harness — from one public contract:
 *
 * - `WorkflowValidator` reads workflow JSON (strict parse: duplicate
 *   keys, `NaN`/`Infinity`, and invalid UTF-8 are errors), selects the
 *   frozen rule set named by `interfaceVersion` by exact match, and runs
 *   the eight-stage validation pipeline with prerequisite gating;
 * - findings carry stable codes, JSON Pointers, line and column when
 *   text is available, related locations, and structured details,
 *   ordered by pointer then code;
 * - `PublicationPreparer` canonicalizes a valid document (RFC 8785) and
 *   computes its SHA-256 digest over the definitional content, with the
 *   metadata members removed.
 *
 * The machine-readable document schema lives in `./schema`; its emitted
 * JSON Schema 2020-12 artifact is
 * `docs/specs/workflow-interface-v1.schema.json`.
 */

export type { Finding, FindingSpec, RelatedLocation } from "./findings";
export {
  compareFindings,
  FindingFactory,
  sortFindings,
} from "./findings";
export type { JsonParseIssue, JsonParseResult, ParseErrorCode } from "./parse/json-source-parser";
export { JsonSourceParser } from "./parse/json-source-parser";
export { CanonicalizationError, canonicalize } from "./publish/canonical-json";
export type { PublicationPreparation } from "./publish/publication-preparer";
export { PublicationPreparer } from "./publish/publication-preparer";
export type { InterfaceRuleSet } from "./rules/interface-rule-set";
export { RuleSetRegistry } from "./rules/interface-rule-set";
export type { StepTypeRegistration } from "./rules/step-type-registry";
export { StepTypeRegistry } from "./rules/step-type-registry";
export { V1_RULE_SET } from "./rules/v1";
export type {
  WorkflowConditional,
  WorkflowDocument as WorkflowDocumentType,
  WorkflowStep,
} from "./schema";
export { WorkflowDocument } from "./schema";
export type { SourceLocation, SourceMap, SourcePointer } from "./source-map";
export { escapePointerToken } from "./source-map";
export { isReferenceObject, LOOP_RESULTS_OUTPUT, STEP_REF_PATTERN } from "./validation/refs";
export type { ValidationStage } from "./validation/validation-stage";
export { ValidationPipeline } from "./validation/validation-stage";
export type { ConditionalNode, StepNode } from "./validation/workflow-graph";
export { WorkflowGraph } from "./validation/workflow-graph";
export type { ValidationResult } from "./workflow-validator";
export { createWorkflowValidator, WorkflowValidator } from "./workflow-validator";
