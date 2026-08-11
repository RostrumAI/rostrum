# E3-04: Implement retries and operator controls

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-05 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E3-02](e3-02-implement-durable-run-storage.md), [E3-03](e3-03-recover-interrupted-runs.md) |

## Task

This task makes attempts retryable and applies durable operator commands. It adds:

- distinct attempt creation and completion for every handler invocation;
- retryable failure classification, attempt limits, and exhaustion;
- a deterministic retry fixture handler;
- cooperative interruption signals for active handlers;
- durable pause, resume, and cancellation processing;
- command precedence and conflict behavior from E3-S2.

## End state

- The daemon can retry bounded failures and pause, resume, or cancel a run without losing its recoverable state.

## Why

- Long-running workflows need visible recovery attempts and urgent operator control before side-effecting handlers are introduced.

## Blocks

- [E3-07: Add durable run Control API operations](e3-07-add-durable-run-control-api-operations.md)
- [E3-08: Build the durable execution conformance suite](e3-08-build-durable-execution-conformance-suite.md)

## Acceptance criteria

- A retryable fixture creates a new attempt until it succeeds or reaches its declared limit.
- Retry exhaustion retains every attempt and produces the specified terminal failure.
- A pause request signals an active reference handler and stops it at its documented recoverable point.
- The interrupted attempt cannot report success, and resume creates the specified new attempt.
- Cancellation prevents later attempts and steps after its recoverable boundary.
- Duplicate commands return their prior disposition, while invalid or conflicting commands return stable results.
- Restart tests prove pending retries and operator commands remain effective.
