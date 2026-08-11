# E3-01: Specify durable execution behavior and fixtures

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-05 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E3-S1](e3-s1-define-checkpoint-and-recovery-semantics.md), [E3-S2](e3-s2-define-attempt-retry-and-control-semantics.md), [E3-S3](e3-s3-define-human-decision-waits.md), [E3-S4](e3-s4-define-run-events-and-artifacts.md) |

## Task

This task combines the four Epic decisions into one durable-execution specification and fixture set. It answers:

- Which records and events commit for every run transition?
- How do restart, retry, interruption, control, and decision transitions compose?
- What can the Control API read or append without advancing execution?
- Which run projection, timeline, attempts, decisions, and artifacts should each example expose?
- Which workflow and handler contract extensions are required?

It also extends the workflow specification and schema for retry configuration and the human-decision step where required.

## End state

- The daemon, Control API, durable store, runtime, and tests can implement the same lifecycle from one specification and shared fixtures.

## Why

- Recovery and control rules cross several components and must not be reinterpreted by each implementation.

## Blocks

- [E3-02: Implement durable run storage](e3-02-implement-durable-run-storage.md)

## Acceptance criteria

- One reviewed specification contains the approved decisions from all four SPIKEs.
- Every transition identifies its required state, attempt, command, decision, event, and artifact effects.
- Restart fixtures cover every checkpoint boundary selected by E3-S1.
- Retry, pause, resume, cancellation, human-decision, cursor, and artifact fixtures include expected records and results.
- Workflow extensions have complete schemas and validation rules.
- Epic 02 successful-run behavior remains compatible when no Epic 03 capability is used.
