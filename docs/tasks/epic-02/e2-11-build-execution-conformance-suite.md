# E2-11: Build the execution conformance suite

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-28 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-03](e2-03-define-executable-workflow-contract.md), [E2-10](e2-10-expose-runs-through-control-api.md) |

## Task

This task turns the E2-03 fixture catalog into one reusable black-box conformance suite. The same applicable fixtures run against:

- the execution runtime directly;
- the daemon through the E2-S2 transport;
- the Control API.

Earlier implementation tasks retain their focused unit and integration tests. This suite proves that every layer interprets the public contract the same way.

## End state

Continuous integration detects any disagreement between the execution specification, shared workflow library, runtime, daemon transport, and Control API.

## Why

A workflow can appear correct in one layer while changing shape or meaning at a process boundary. Shared fixtures make those differences observable before later Epics add persistence and remote workers.

## Blocks

- [E2-12: Prove local execution end to end](e2-12-prove-local-execution-end-to-end.md)

## Acceptance criteria

- Every E2-03 fixture declares the applicable layers, request, expected state or causal constraints, and terminal result.
- The same sequential, conditional, parallel, loop, rejection, and failure fixtures run at every applicable layer.
- Each layer returns the same public run status, ordered `currentSteps`, output, and ordered failures.
- Invalid invocation fixtures distinguish rejection from accepted-run failure.
- Parallel fixtures run under multiple handler limits and controlled completion orders.
- Tests prove that unselected paths do not execute and joins do not start early.
- Tests prove fail-fast and error-tolerant loop behavior, including ordered mixed results.
- Concurrent trace checks assert causal relationships instead of one completion order.
- The complete suite runs in continuous integration with deterministic control points and no timing-based sleeps.
