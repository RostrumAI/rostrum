# E2-05: Implement the local graph executor

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-27 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-03](e2-03-implement-execution-state-and-step-input-resolution.md), [E2-04](e2-04-implement-step-handler-boundary.md) |

## Task

This task creates the dispatcher and transition reducer that moves a run through its compiled workflow plan. It performs these operations:

- begin at the declared starting step (`firstNode`);
- resolve step inputs and invoke registered handlers through a bounded worker pool;
- record outcomes and validate exact outputs;
- advance sequential connections, evaluate executor-owned conditionals, coordinate fan-out path roots and matching fan-in dependency barriers, and execute sequential loop iterations;
- maintain `currentSteps` (ready and running instances);
- bind explicit terminal `result` outputs;
- on an unhandled failure, immediately stop new dispatches, allow running handlers to finish, collect all observed run failures into a stably sorted array, and mark the run failed.

## End state

- The daemon can execute a supported published workflow from its starting step to a terminal result or structured failure.

## Why

- A workflow becomes executable only when Rostrum can advance through its declared graph.

## Blocks

- [E2-06: Expose local runs through the Control API](e2-06-add-control-api-run-operations.md)
- [E2-07: Build the local execution conformance suite](e2-07-build-local-execution-conformance-suite.md)

## Acceptance criteria

- Sequential fixtures execute each expected step once and in order.
- Branching fixtures execute only the executor-selected path.
- Fan-out paths activate their roots concurrently, can contain sequential steps and properly nested fan-outs, respect worker pool limits, and synchronize at the matching fan-in barrier.
- Sequential loops execute iterations strictly in order, apply the workflow's configured error-tolerance policy, and produce the ordered result entries defined by E2-02.
- Terminal results bind explicit output objects at explicit `result` steps.
- An unhandled failure prevents new dispatches, drains active handlers, and returns all observed run failures in a stable ordered array.
- The executor uses shared validation, binding, and handler contracts without API-specific logic.
