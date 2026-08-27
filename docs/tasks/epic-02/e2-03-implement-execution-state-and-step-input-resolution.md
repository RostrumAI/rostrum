# E2-03: Implement execution state and step input resolution

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-26 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-01](e2-01-build-local-daemon-foundation.md), [E2-02](e2-02-specify-executable-workflow-behavior.md) |

## Task

This task creates the in-memory state used during a local run. It performs these operations:

- create a run ID and initial state;
- validate invocation inputs against the selected published workflow (reject missing or undeclared inputs);
- project `currentSteps` (ready and running step instances, with iteration index for loops);
- resolve workflow inputs and completed step outputs into handler inputs against required and optional input schemas;
- validate returned handler outputs against exact output schemas;
- record state transitions, step outcomes, and complete failure arrays;
- record the final workflow output or structured failure.
## End state

- Given a run and a step, the runtime can produce the step's resolved inputs and record its outcome.

## Why

- The graph executor needs one source of truth for the run's current state and available values.

## Blocks

- [E2-05: Implement the local graph executor](e2-05-implement-local-graph-executor.md)

## Acceptance criteria

- Every accepted invocation receives a stable run ID.
- Invalid or undeclared invocation inputs fail before a run is accepted or a handler runs.
- Required handler input bindings resolve fully; missing optional bindings default cleanly while provided optional bindings resolve.
- Step instances transition through `ready`, `running`, `succeeded`, and `failed` states, maintaining an accurate `currentSteps` projection.
- Workflow-input and completed-step references resolve to the expected handler values.
- Missing, incompatible, or undeclared values produce a stable structured failure recorded in the `failures` array.
- Tests cover all allowed state transitions and reject invalid transitions.
