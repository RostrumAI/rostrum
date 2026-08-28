# E2-09: Execute bounded loops

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-28 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-08](e2-08-execute-parallel-paths-and-joins.md) |

## Task

This task completes workflow interface v1 execution by adding bounded loops.

It implements:

- collection resolution and array validation;
- a bound check before iteration zero starts;
- one active iteration at a time in collection order;
- loop-variable binding within the active iteration;
- unique identity for every body step and iteration;
- complete workflow sections inside an iteration, including structured parallel work;
- one ordered result entry per iteration;
- fail-fast and error-tolerant loop policies;
- loop iteration visibility in `currentSteps`;
- structured handling of one or more failures observed within an iteration.

## End state

The daemon executes every workflow interface v1 control-flow construct and returns the documented ordered loop results or failures.

## Why

Loops are part of the initial workflow language. Deferring them would leave Epic 02 with an executor that accepts workflows it cannot run.

## Blocks

- [E2-10: Expose runs through the Control API](e2-10-expose-runs-through-control-api.md)

## Acceptance criteria

- An empty collection succeeds with an empty ordered result.
- A collection longer than `maxIterations` fails before iteration zero starts.
- A non-array collection fails with the documented loop failure.
- Iteration `n + 1` starts only after iteration `n` commits its result.
- Successful iterations contribute one exact output entry at their collection position.
- Fail-fast loops stop before the next iteration after an unhandled iteration failure.
- Error-tolerant loops capture eligible failures at the correct result position and continue.
- An iteration with multiple observed failures preserves their complete stable order in its error entry.
- Parallel work inside an iteration follows the E2-08 join and failure rules.
- `currentSteps` includes the documented iteration identity for active loop-body steps.
- Tests cover empty, successful, over-bound, wrong-type, fail-fast, error-tolerant, and parallel-body loops.
