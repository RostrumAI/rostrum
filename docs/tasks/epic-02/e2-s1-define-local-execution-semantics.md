# E2-S1: Decide how a local run advances

| Tracking | Value |
| --- | --- |
| Status | Proposed — awaiting approval |
| Last updated | 2026-08-26 |
| Picked up | Yes |
| Owner | Stephen |
| Blocked by | [Epic 01](../../epics/epic-01-shape-of-a-workflow.md) |

## Task

Research and owner decisions are recorded in [E2-S1 local execution semantics options](../../research/e2-s1-local-execution-semantics-options.md). The [execution semantics proof of concept](../../results/epic-02/e2-s1-proof-of-concept.md) verifies the proposed scheduler, structured fan-out rules, capacity-bound dispatch, sequential loops with structured graph bodies, failure ordering, and large synthetic graphs. The product owner has resolved all questions Q1 through Q18.

This SPIKE decides how a local run starts, advances, and ends. It answers:

- When is an invocation accepted or rejected?
- Which run and active-step states (`currentSteps`) are visible through the Control API?
- When is a step ready to execute?
- How are required and optional inputs bound, and how are exact outputs recorded?
- How does the executor evaluate conditionals, single-entry single-exit fan-out/fan-in regions, and sequential loops?
- What completes or fails a run, and how are multiple observed failures aggregated?
## End state

- One reviewed decision record ([E2-S1 local execution semantics](../../decisions/epic-02/e2-s1-local-execution-semantics.md)) and example traces define local execution behavior.

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
