# E1-04: Implement the workflow library and validator

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-01](e1-01-create-project-foundation.md), [E1-03](e1-03-write-workflow-interface-v1-specification.md) |

## Task

This task creates the shared library that reads and validates workflow JSON. It performs these operations:

- parse workflow JSON according to the selected duplicate-key rule;
- select validation rules from the interface version;
- run schema and workflow checks in the documented order;
- return stable validation findings;
- prepare a valid revision for publication using the approved identity and digest rules.

## End state

- The Control API and future daemon can use one library to read, validate, and prepare workflow JSON for publication.

## Why

- Every workflow operation needs the same implementation of the public specification.

## Blocks

- [E1-05: Create validation fixtures and expected findings](e1-05-build-workflow-example-validation-suite.md)
- [E1-06: Expose workflow authoring through the Control API](e1-06-add-control-api-workflow-operations.md)

## Acceptance criteria

- The library reads workflow JSON and selects validation rules from its interface version.
- Validation runs the documented checks in the required order.
- Findings use the codes, locations, blocking decisions, and ordering defined by E1-S2.
- Publication preparation follows the identity and digest rules from E1-S3.
- API-specific behavior stays outside the shared library.
- Unit tests cover every public operation and validation stage.
