# E2-07: Build the local execution conformance suite

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-02](e2-02-specify-executable-workflow-behavior.md), [E2-05](e2-05-implement-local-graph-executor.md), [E2-06](e2-06-add-control-api-run-operations.md) |

## Task

This task turns the E2-02 fixtures into automated conformance tests. The suite verifies:

- sequential success;
- each declared branch;
- invalid invocation;
- input-resolution failure;
- handler failure;
- invalid runtime outcome;
- consistent results across the runtime, daemon transport, and Control API.

## End state

- Continuous integration detects any execution behavior that disagrees with the approved fixtures.

## Why

- The execution layers need one reusable test suite that proves they interpret the contract consistently.

## Blocks

- [E2-08: Document how to run workflows locally](e2-08-publish-local-run-guidance.md)
- [E2-09: Prove local workflow execution end to end](e2-09-add-end-to-end-epic-demonstration.md)

## Acceptance criteria

- Every documented fixture has expected trace and result data.
- The runtime and API pass the same applicable fixtures.
- Each failure path asserts stable code, run ID, and step ID when applicable.
- Tests prove an unselected branch does not execute.
- The suite runs in continuous integration.
