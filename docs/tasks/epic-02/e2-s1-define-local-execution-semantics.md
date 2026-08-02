# E2-S1: Decide how a local run advances

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [Epic 01](../../epics/epic-01-shape-of-a-workflow.md) |

## Task

This SPIKE decides how a local run starts, advances, and ends. It answers:

- When is an invocation accepted or rejected?
- Which run states are visible through the Control API?
- When is a step ready to execute?
- How are inputs bound and outputs recorded?
- How does a result select the next connection or branch?
- What completes or fails a run?

## End state

- One reviewed decision record and example traces define local execution behavior.

## Why

- The daemon, Control API, and tests need the same rules for interpreting a v1 workflow graph.

## Blocks

- [E2-S3: Select the reference steps for local execution](e2-s3-define-reference-step-set.md)
- [E2-02: Specify executable workflow behavior and fixtures](e2-02-specify-executable-workflow-behavior.md)

## Acceptance criteria

- The decision record defines every state transition and terminal outcome.
- Sequential, branching, success, and failure examples have expected execution traces.
- Binding and branch rules are deterministic and testable.
- Unsupported steps, invalid outcomes, and unresolved references have stable failures.
- The design can add persistence and recovery in Epic 03 without changing successful-run semantics.
