# E1-02: Create the standalone Control API process

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-01](e1-01-create-project-foundation.md) |

## Task

This task creates the Control API as a separately runnable process. It adds:

- startup and graceful shutdown;
- configuration and structured logging;
- health and version reporting;
- versioned routing and one error shape;
- generated or contract-checked API documentation;
- an integration-test harness for the running service.

## End state

- A developer can start the Control API independently and verify its configuration, health, version, routing, errors, and shutdown behavior.

## Why

- Workflow validation, drafts, and publication need one service process that clients can call.

## Blocks

- [E1-06: Expose workflow authoring through the Control API](e1-06-add-control-api-workflow-operations.md)

## Acceptance criteria

- The Control API starts and stops cleanly as an independent process.
- Configuration and logs follow the conventions selected by E1-S0.
- Health and version routes return documented responses.
- API routes use a documented versioning convention and consistent error shape.
- API documentation is generated from the implemented contract or checked against it.
- Integration tests start the service and exercise its foundation routes.
