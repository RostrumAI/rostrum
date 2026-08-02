# E2-02: Specify executable workflow behavior and fixtures

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-S1](e2-s1-define-local-execution-semantics.md), [E2-S2](e2-s2-select-local-daemon-transport.md), [E2-S3](e2-s3-define-reference-step-set.md) |

## Task

This task combines the decisions from E2-S1, E2-S2, and E2-S3 into one specification and fixture set. It answers:

- What does a run request contain?
- What states can a run enter?
- How are workflow inputs and step outputs referenced?
- What does a step handler receive and return?
- What constitutes success or failure?
- What trace and result should each example workflow produce?

It also extends the workflow specification and schema for the reference step set where required.

## End state

- The daemon, Control API, executor, and tests can implement the same behavior from one specification and shared fixtures.

## Why

- Without this task, the SPIKE decisions remain separate and implementations can interpret them differently.

## Blocks

- [E2-03: Implement execution state and step input resolution](e2-03-implement-execution-state-and-step-input-resolution.md)
- [E2-04: Implement the step registry and reference handlers](e2-04-implement-step-handler-boundary.md)
- [E2-07: Build the local execution conformance suite](e2-07-build-local-execution-conformance-suite.md)

## Acceptance criteria

- One reviewed specification contains the approved decisions from all three SPIKEs.
- Run requests, states, references, handler outcomes, branches, results, and failures are defined.
- Reference steps have complete schemas and validation rules.
- Sequential, branching, invalid-invocation, and step-failure fixtures include their expected traces and results.
- API and daemon messages in the fixtures match the E2-S2 transport contract.
- Epic 01 validation accepts valid workflow fixtures and rejects invalid definitions.
