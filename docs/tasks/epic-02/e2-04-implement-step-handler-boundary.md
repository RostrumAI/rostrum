# E2-04: Implement the step registry and reference handlers

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-01](e2-01-build-local-daemon-foundation.md), [E2-02](e2-02-specify-executable-workflow-behavior.md) |

## Task

This task creates the interface used to execute one workflow step. It adds:

- a registry that selects a handler by step type;
- one handler input, output, and failure shape;
- the reference handlers selected by E2-S3;
- stable failures for unknown or misconfigured handlers.

## End state

- The runtime can submit one configured step with resolved inputs and receive a documented outcome.

## Why

- The graph executor needs one consistent way to invoke every supported step type.

## Blocks

- [E2-05: Implement the local graph executor](e2-05-implement-local-graph-executor.md)

## Acceptance criteria

- The runtime selects handlers by the documented step type.
- Handlers receive only resolved inputs and declared configuration.
- Reference handlers return the documented outcomes for every fixture.
- Handler failures retain their stable code and step identity.
- Unit tests prove registration, selection, success, and failure behavior.
