# E2-S2: Select the local daemon transport

| Tracking | Value |
| --- | --- |
| Status | Completed |
| Last updated | 2026-09-03 |
| Picked up | Yes |
| Owner | Stephen |
| Blocked by | [Epic 01](../../epics/epic-01-shape-of-a-workflow.md) |

## Task

This SPIKE is a task that investigates and selects a technical approach. It determines how the separately running Control API and daemon communicate locally. It answers the following questions:

- How does the Control API submit a run request?
- How does it retrieve a current run or a terminal run (a run that has reached its final state)?
- How are requests and responses correlated (matched so each response is associated with its request)?
- How are health checks, timeouts, and daemon unavailability reported?
- How does the transport carry structured invocation rejection (a rejection with a defined set of fields), `currentSteps`, output, and failures without redefining them?

The transport owns message delivery and correlation. E2-03 owns workflow and run semantics.

## End state

The end state is approval of one transport, message envelope (a wrapper that carries a request or response), error mapping (rules for representing errors between the two processes), and configuration approach for implementation.

## Why

The Control API and daemon need one testable local connection so they can remain independently runnable processes.

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
