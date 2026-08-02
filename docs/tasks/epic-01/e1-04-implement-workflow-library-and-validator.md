# E1-04: Implement the workflow library and validator

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-01](e1-01-create-project-foundation.md), [E1-03](e1-03-write-workflow-interface-v1-specification.md) |

## Task

- Implement the shared workflow types, JSON reader, schema checks, workflow checks, publication preparation, and validation findings.
- Expose one shared interface for the Control API and future daemon.

## Why

- One implementation prevents draft saves, explicit validation, publication, and future execution from applying different workflow rules.

## Blocks

- [E1-05: Build the workflow example and validation suite](e1-05-build-workflow-example-validation-suite.md)
- [E1-06: Add Control API workflow operations](e1-06-add-control-api-workflow-operations.md)

## Acceptance criteria

- The library reads workflow JSON and selects validation rules from its interface version.
- Validation runs the documented checks in the required order.
- Findings use the codes, locations, blocking decisions, and ordering defined by E1-S2.
- Publication preparation follows the identity and digest rules from E1-S3.
- API-specific behavior stays outside the shared library.
- Unit tests cover every public operation and validation stage.

