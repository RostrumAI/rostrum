import { type Static, Type } from "typebox";

/**
 * Entry point of the shared workflow package.
 *
 * E1-01 establishes the package boundary and its toolchain. E1-03 publishes
 * the workflow interface v1 JSON Schema, and E1-04 replaces this surface with
 * the interface schema, the validator, stable findings, and the digest rules.
 */
export const workflowInterfaceVersionSchema = Type.Literal("v1");

export type WorkflowInterfaceVersion = Static<typeof workflowInterfaceVersionSchema>;
