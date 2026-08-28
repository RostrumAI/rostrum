# E2-S2: Select the local daemon transport

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-28 |
| Picked up | Yes |
| Owner | Stephen |
| Blocked by | [Epic 01](../../epics/epic-01-shape-of-a-workflow.md) |

## Task

This SPIKE selects how the separately running Control API and daemon communicate locally. It answers:

- How does the Control API submit a run request?
- How does it retrieve a current or terminal run?
- How are requests and responses correlated?
- How are health checks, timeouts, and daemon unavailability reported?
- How does the transport carry structured invocation rejection, `currentSteps`, output, and failures without redefining them?

The transport owns message delivery and correlation. E2-03 owns workflow and run semantics.

## End state

One transport, message envelope, error mapping, and configuration approach are approved for implementation.

## Why

The Control API and daemon need one testable local connection while remaining independently runnable processes.

## Blocks

- [E2-03: Define the executable workflow contract](e2-03-define-executable-workflow-contract.md)
- [E2-05: Build the local daemon](e2-05-build-local-daemon.md)

## Acceptance criteria

- The decision selects the local transport and explains the tradeoffs.
- Request and response examples cover submission, lookup, rejection, timeout, and daemon unavailability.
- The transport can carry the complete E2-03 request and run representations without defining graph behavior.
- The transport supports independent local processes and automated integration tests.
- The daemon interface remains internal; callers continue to use the Control API.
- The product owner and implementing engineer approve the decision before E2-03 or E2-05 begins.
