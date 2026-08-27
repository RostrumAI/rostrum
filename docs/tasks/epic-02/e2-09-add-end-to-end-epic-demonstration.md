# E2-09: Prove local workflow execution end to end

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-26 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-06](e2-06-add-control-api-run-operations.md), [E2-07](e2-07-build-local-execution-conformance-suite.md), [E2-08](e2-08-publish-local-run-guidance.md) |

## Task

This task creates one repeatable proof of the complete Epic 2 product state. It:

- starts the Control API and daemon as separate processes;
- publishes and invokes sequential, branching, structured fan-out/fan-in, and sequential loop workflows;
- verifies their step traces, `currentSteps` transitions, and final outputs;
- verifies invalid invocation, exact output mismatches, and multi-failure collection;
- verifies that caller disconnection does not stop a run;
- runs from one command in continuous integration.
## End state

- One release gate proves that published workflows execute locally through the real API and daemon boundary.

## Why

- Individual tests need one end-to-end counterpart that proves the assembled product state.

## Blocks

- Epic 03: Durable runs and human control

## Acceptance criteria

- The daemon and Control API start as separate processes.
- A sequential run binds data across multiple steps and returns the expected result.
- Separate branching runs prove each declared path and skip the other path.
- Structured fan-out and fan-in runs prove parallel branch dispatch and barrier synchronization.
- Sequential loop runs prove collection-order execution and iteration output collection.
- Invalid input fails before step execution.
- A handler failure stops later steps, drains active workers, and returns the expected structured failures array.
- A run completes after its invoking client disconnects.
- One documented command runs the demonstration in continuous integration.
