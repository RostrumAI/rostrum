# E2-06: Expose local runs through the Control API

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-05](e2-05-implement-local-graph-executor.md) |

## Task

This task gives callers two Control API operations:

- start a run for an exact published workflow version and structured inputs;
- retrieve the run's current status, final output, or structured failure.

Both operations communicate with the daemon through the E2-S2 transport contract.

## End state

- A caller can start and inspect a local run without connecting directly to the daemon.

## Why

- Every client needs the same public boundary for invoking and observing workflow execution.

## Blocks

- [E2-07: Build the local execution conformance suite](e2-07-build-local-execution-conformance-suite.md)
- [E2-08: Document how to run workflows locally](e2-08-publish-local-run-guidance.md)
- [E2-09: Prove local workflow execution end to end](e2-09-add-end-to-end-epic-demonstration.md)

## Acceptance criteria

- A valid request returns a run ID without requiring the connection to remain open.
- Retrieval returns the documented current or terminal run representation.
- Unknown workflows, invalid inputs, unknown runs, and unavailable daemon behavior match the API contract.
- Published workflow resolution uses the immutable version requested by the caller.
- API integration tests do not execute graph logic inside the Control API.
