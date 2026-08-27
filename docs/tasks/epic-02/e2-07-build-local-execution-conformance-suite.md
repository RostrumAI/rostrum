# E2-07: Build the local execution conformance suite

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-26 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-02](e2-02-specify-executable-workflow-behavior.md), [E2-05](e2-05-implement-local-graph-executor.md), [E2-06](e2-06-add-control-api-run-operations.md) |

## Task

This task turns the E2-02 fixtures into automated conformance tests. The suite verifies:

- sequential success;
- each declared branch;
- structured fan-out and fan-in under different worker concurrency levels and completion orders;
- sequential bounded loops and iteration failure handling;
- invalid invocation (missing and undeclared inputs);
- input-resolution failure;
- handler failure;
- exact output schema validation failure;
- multi-failure collection and deterministic sorting;
- consistent `currentSteps` and run state across the runtime, daemon transport, and Control API.
## End state

- Continuous integration detects any execution behavior that disagrees with the approved fixtures.

## Why

- The execution layers need one reusable test suite that proves they interpret the contract consistently.

## Blocks

- [E2-08: Document how to run workflows locally](e2-08-publish-local-run-guidance.md)
- [E2-09: Prove local workflow execution end to end](e2-09-add-end-to-end-epic-demonstration.md)

## Acceptance criteria

- Every documented fixture has expected trace, `currentSteps`, and result data.
- The runtime and API pass the same applicable fixtures.
- Each failure path asserts stable code, run ID, step ID, and complete `failures` array when applicable.
- Tests prove an unselected branch does not execute.
- Tests prove fan-out completion order does not affect final joined results.
- The suite runs in continuous integration.
