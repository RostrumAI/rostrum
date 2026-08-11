# E3-S2: Decide attempt, retry, and operator control behavior

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-05 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [Epic 02](../../epics/epic-02-local-workflow-execution.md) |

## Task

This SPIKE decides how Rostrum records handler attempts and applies bounded retries and operator commands. It answers:

- What identifies an attempt and which outcomes can it enter?
- Which failures are retryable and where is the maximum attempt count configured?
- How does recovery preserve retry limits and a pending retry?
- How are pause, resume, and cancellation commands ordered and made idempotent?
- How does an active handler observe an urgent pause or cancellation request?
- What constitutes a recoverable interruption point?
- Which command wins when execution, pause, resume, cancellation, and retry readiness race?

## End state

- One reviewed decision record and transition matrix define attempts, retries, interruption, pause, resume, and cancellation.

## Why

- Operators and recovery need deterministic rules that prevent retries or later steps from running after a durable control request.

## Blocks

- [E3-01: Specify durable execution behavior and fixtures](e3-01-specify-durable-execution-behavior.md)

## Acceptance criteria

- Every handler invocation receives a distinct attempt identity and number.
- Retry classification, maximum attempts, exhaustion, and restart behavior are defined.
- Pause and cancellation requests can interrupt the reference handler at a documented safe point.
- A paused attempt resumes as a new attempt unless a future handler contract supplies its own resumable checkpoint.
- Command acknowledgement is distinct from completion of the requested transition.
- A precedence table resolves command, retry, and execution races.
