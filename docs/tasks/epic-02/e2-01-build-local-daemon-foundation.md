# E2-01: Create the local daemon process

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-S2](e2-s2-select-local-daemon-transport.md) |

## Task

This task creates the daemon as a separately runnable application. It adds:

- startup and graceful shutdown;
- configuration and structured logging;
- health and version reporting;
- the local transport selected by E2-S2;
- an integration-test harness for the running process.

## End state

- A developer can start the daemon independently and verify its configuration, health, version, transport, and shutdown behavior.

## Why

- Rostrum needs a dedicated process in which local workflow execution can run.

## Blocks

- [E2-03: Implement execution state and step input resolution](e2-03-implement-execution-state-and-step-input-resolution.md)
- [E2-04: Implement the step registry and reference handlers](e2-04-implement-step-handler-boundary.md)

## Acceptance criteria

- Documented commands build, start, stop, and test the daemon.
- The daemon reports health and version independently of the Control API.
- Invalid configuration fails with an actionable error.
- Graceful shutdown stops accepting work and ends cleanly.
- Automated tests exercise the transport selected by E2-S2.
