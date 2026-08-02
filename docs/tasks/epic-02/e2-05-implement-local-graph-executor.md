# E2-05: Implement the local graph executor

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-03](e2-03-implement-execution-state-and-step-input-resolution.md), [E2-04](e2-04-implement-step-handler-boundary.md) |

## Task

This task creates the loop that moves a run through its workflow graph. It performs these operations:

- begin at the declared starting step;
- resolve the step inputs and invoke its registered handler;
- record the outcome;
- follow the sequential connection or selected branch;
- bind terminal outputs;
- stop at completion or the first failure.

## End state

- The daemon can execute a supported published workflow from its starting step to a terminal result or structured failure.

## Why

- A workflow becomes executable only when Rostrum can advance through its declared graph.

## Blocks

- [E2-06: Expose local runs through the Control API](e2-06-add-control-api-run-operations.md)
- [E2-07: Build the local execution conformance suite](e2-07-build-local-execution-conformance-suite.md)

## Acceptance criteria

- Sequential fixtures execute each expected step once and in order.
- Branching fixtures execute only the selected path.
- Terminal results contain the documented workflow outputs.
- A failure stops later steps and produces the documented run failure.
- The executor uses shared validation, binding, and handler contracts without API-specific logic.
