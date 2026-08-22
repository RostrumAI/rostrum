export type { WorkflowDocument as WorkflowDocumentType, WorkflowInterfaceVersion } from "./schema";
export { WorkflowDocument, workflowInterfaceVersionSchema } from "./schema";

/**
 * Entry point of the shared workflow package.
 *
 * E1-01 established the package boundary; E1-03 publishes the workflow
 * interface v1 document schema (source: `./schema`; machine-readable JSON
 * Schema 2020-12 artifact: `docs/specs/workflow-interface-v1.schema.json`).
 * E1-04 adds the staged validator, stable findings, and the production
 * digest implementation on top of this schema.
 */
