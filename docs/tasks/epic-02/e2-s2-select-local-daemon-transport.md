# E2-S2: Select the local daemon transport

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [Epic 01](../../epics/epic-01-shape-of-a-workflow.md) |

## Task

This SPIKE selects how the separately running Control API and daemon communicate locally. It answers:

- How does the Control API submit a run?
- How does it retrieve run status and results?
- How are requests and responses correlated?
- How are health checks, timeouts, and daemon unavailability reported?

## End state

- One transport, message contract, and configuration approach are approved for implementation.

## Why

- The two established processes need one communication mechanism that can be configured and tested locally.

## Blocks

- [E2-01: Create the local daemon process](e2-01-build-local-daemon-foundation.md)
- [E2-02: Specify executable workflow behavior and fixtures](e2-02-specify-executable-workflow-behavior.md)

## Acceptance criteria

- The decision record selects the local transport and explains the tradeoffs.
- Request and response examples cover submission, lookup, rejection, timeout, and daemon unavailability.
- The transport supports independent local processes and automated integration tests.
- The daemon interface remains internal; callers continue to use the Control API.
- The contract does not duplicate workflow or execution rules.
