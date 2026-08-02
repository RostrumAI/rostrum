# E1-02: Build the Control API foundation

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-01](e1-01-create-project-foundation.md) |

## Task

- Build the standalone Control API process.
- Add configuration, logging, startup and shutdown behavior, health and version reporting, versioned routing, consistent errors, generated API documentation, and integration-test support.

## Why

- Draft storage, validation, and publication need a stable service boundary that Epic 02 can extend without embedding the daemon.

## Blocks

- [E1-06: Add Control API workflow operations](e1-06-add-control-api-workflow-operations.md)

## Acceptance criteria

- The Control API starts and stops cleanly as an independent process.
- Configuration and logs follow the conventions selected by E1-S0.
- Health and version routes return documented responses.
- API routes use a documented versioning convention and consistent error shape.
- API documentation is generated from the implemented contract or checked against it.
- Integration tests start the service and exercise its foundation routes.

