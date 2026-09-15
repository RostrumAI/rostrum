/** @fileoverview Workflow format rule-set registry used by the Control API. */

import {
    V1_WORKFLOW_FORMAT_RULE_SET,
    WorkflowFormatRegistry,
    WorkflowValidator,
} from "@rostrum/workflow";

/**
 * The rule-set registry this process validates and publishes against.
 *
 * This module is the single wiring point for validation and publication
 * rule selection: when a second format version ships, the workflow
 * store's verification (`getPublication`) must select its rule set
 * from the stored `workflow_format_version` through this registry, instead of
 * the single default canonicalizer `WorkflowService.create` constructs. No
 * storage change is needed while v1 is the only supported version.
 */
export const WORKFLOW_FORMAT_REGISTRY = new WorkflowFormatRegistry([V1_WORKFLOW_FORMAT_RULE_SET]);

/**
 * The process-wide validator over {@link WORKFLOW_FORMAT_REGISTRY}. Equivalent to
 * the library's `createWorkflowValidator()` with the registry reference
 * retained, so publication can select the declared format version's rule set from
 * the same registry the validation ran under.
 */
export const WORKFLOW_VALIDATOR = new WorkflowValidator(WORKFLOW_FORMAT_REGISTRY);
