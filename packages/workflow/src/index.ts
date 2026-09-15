/**
 * Entry point of the shared workflow package.
 *
 * The package implements workflow format v1 for every consumer —
 * Control API, daemon, conformance harness — from one public contract:
 *
 * - `WorkflowValidator` reads workflow JSON (strict parse: duplicate
 *   keys, `NaN`/`Infinity`, and invalid UTF-8 are errors), selects the
 *   frozen rule set named by `workflowFormatVersion` by exact match, and runs
 *   the eight-stage validation pipeline with prerequisite gating;
 * - findings carry stable codes, JSON Pointers, line and column when
 *   text is available, related locations, and structured details,
 *   ordered by pointer then code;
 * - `PublicationCanonicalizer` canonicalizes a valid document (RFC 8785) and
 *   computes its SHA-256 digest over the definitional content, with the
 *   metadata members removed.
 *
 * The machine-readable document schema lives in `./schema`; its emitted
 * JSON Schema 2020-12 artifact describes the format's document shape.
 */

export { insertWorkflowId, replaceWorkflowId } from "./document/id-splice";
export type { Finding, FindingSpec, RelatedLocation } from "./findings";
export {
    compareFindings,
    FindingFactory,
    sortFindings,
} from "./findings";
export type {
    JsonSourceMap,
    JsonSourcePointer,
    SourceLocation,
} from "./json-source-map";
export { escapePointerToken } from "./json-source-map";
export type { JsonParseIssue, JsonParseResult, ParseErrorCode } from "./parse/json-source-parser";
export { JsonSourceParser } from "./parse/json-source-parser";
export type { ParsedWorkflow } from "./parse/parse-workflow";
export { parseWorkflow } from "./parse/parse-workflow";
export { CanonicalizationError, canonicalize } from "./publish/canonical-json";
export type { CanonicalPublication } from "./publish/publication-canonicalizer";
export { PublicationCanonicalizer } from "./publish/publication-canonicalizer";
export type { StepTypeRegistration } from "./rules/step-type-registry";
export { StepTypeRegistry } from "./rules/step-type-registry";
export { V1_WORKFLOW_FORMAT_RULE_SET } from "./rules/v1";
export type { WorkflowFormatRuleSet } from "./rules/workflow-format-rule-set";
export { WorkflowFormatRegistry } from "./rules/workflow-format-rule-set";
export type {
    WorkflowConditional,
    WorkflowDocument,
    WorkflowStep,
} from "./schema";
export { WorkflowDocumentSchema } from "./schema";
export {
    isReferenceObject,
    LOOP_RESULTS_OUTPUT,
    STEP_OUTPUT_REF_PATTERN,
} from "./validation/data-references";
export type { ValidationStage } from "./validation/validation-stage";
export { ValidationPipeline } from "./validation/validation-stage";
export type { ConditionalNode, StepNode } from "./validation/workflow-graph";
export { WorkflowGraph } from "./validation/workflow-graph";
export type { ValidationResult } from "./workflow-validator";
export { createWorkflowValidator, WorkflowValidator } from "./workflow-validator";
