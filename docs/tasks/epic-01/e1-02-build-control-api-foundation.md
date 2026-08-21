# E1-02: Create the standalone Control API process

| Tracking | Value |
| --- | --- |
| Status | Done |
| Last updated | 2026-08-21 |
| Picked up | Yes |
| Owner | Thomas |
| Blocked by | [E1-01](e1-01-create-project-foundation.md) |

## Task

This task creates the Control API as a separately runnable process using the stack selected by [E1-S0](../../decisions/epic-01/e1-s0-implementation-stack.md). It adds:

- Startup and graceful shutdown using `Bun.serve` with a Hono application as the request handler.
- Configuration via environment variables (`DATABASE_URL`) and structured logging following E1-S0 conventions.
- Health and version reporting.
- Versioned routing and one error shape.
- OpenAPI 3.1 contract generated code-first from TypeBox schemas (JSON Schema 2020-12 as the single schema language for the workflow specification and the API contract), and API documentation generated from or checked against the implemented contract.
- An integration-test harness that exercises the running service via `app.fetch()` without sockets, and that will later host the conformance suites.

The Control API and future daemon are independently runnable applications that share workflow code via the workspace packages.

## End state

- A developer can start the Control API independently and verify its configuration, health, version, routing, errors, and shutdown behavior.

## Why

- Workflow validation, drafts, and publication need one service process that clients can call.

## Blocks

- [E1-06: Expose workflow authoring through the Control API](e1-06-add-control-api-workflow-operations.md)

## Acceptance criteria

- The Control API starts and stops cleanly as an independent process using Hono for routing on Bun's native HTTP server (`Bun.serve`).
- Configuration and logs follow the conventions selected by E1-S0 (environment overrides, structured logging).
- Health and version routes return documented responses.
- API routes use a documented versioning convention and consistent error shape.
- API documentation is generated from the implemented TypeBox/OpenAPI 3.1 contract or checked against it.
- Integration tests start the service via `app.fetch()` and exercise its foundation routes.
