import { RuleSetRegistry, V1_RULE_SET, WorkflowValidator } from "@rostrum/workflow";

/**
 * The rule-set registry this process validates and publishes against.
 *
 * This module is the single wiring point for validation and publication
 * rule selection: when a second interface version ships, the workflow
 * store's verification (`getPublishedVersion`) must select its rule set
 * from the stored `interface_version` through this registry, instead of
 * the single default preparer `createWorkflowDatabase` constructs. No
 * storage change is needed while v1 is the only supported version.
 */
export const RULE_SET_REGISTRY = new RuleSetRegistry([V1_RULE_SET]);

/**
 * The process-wide validator over {@link RULE_SET_REGISTRY}. Equivalent to
 * the library's `createWorkflowValidator()` with the registry reference
 * retained, so publication can select the declared version's rule set from
 * the same registry the validation ran under.
 */
export const WORKFLOW_VALIDATOR = new WorkflowValidator(RULE_SET_REGISTRY);
