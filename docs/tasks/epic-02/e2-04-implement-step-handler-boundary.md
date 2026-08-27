# E2-04: Implement the step registry and reference handlers

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-27 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-01](e2-01-build-local-daemon-foundation.md), [E2-02](e2-02-specify-executable-workflow-behavior.md) |

## Task

This task creates the interface used to execute one workflow step. It adds:

- a registry that selects a handler by step type;
- one handler interface returning `{ type: "success", outputs }` or `{ type: "failure", error }` after receiving resolved required and optional inputs;
- runtime schema validation for exact output shapes;
- the reference handlers selected by E2-S3;
- stable failures for unknown, misconfigured, or schema-violating handlers.

- The runtime can submit one configured step with resolved inputs and receive a documented outcome.

## Why

- The graph executor needs one consistent way to invoke every supported step type.

## Blocks

- [E2-05: Implement the local graph executor](e2-05-implement-local-graph-executor.md)

## Acceptance criteria

- The runtime selects handlers by the documented step type.
- Handlers receive only resolved required and provided optional inputs and declared configuration.
- Handler outcomes use the `type` discriminator and are validated against declared exact output schemas, forbidding missing or undeclared keys and type mismatches.
- Reference handlers return the documented outcomes for every fixture.
- Handler failures retain their stable code and step identity.
- Unit tests prove registration, selection, success, output validation, and failure behavior.
