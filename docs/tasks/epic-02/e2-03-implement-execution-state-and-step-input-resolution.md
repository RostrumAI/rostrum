# E2-03: Implement execution state and step input resolution

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-01](e2-01-build-local-daemon-foundation.md), [E2-02](e2-02-specify-executable-workflow-behavior.md) |

## Task

This task creates the in-memory state used during a local run. It performs these operations:

- create a run ID and initial state;
- validate invocation inputs against the selected published workflow;
- resolve workflow inputs and completed step outputs into handler inputs;
- record state transitions and step outcomes;
- record the final workflow output or structured failure.

## End state

- Given a run and a step, the runtime can produce the step's resolved inputs and record its outcome.

## Why

- The graph executor needs one source of truth for the run's current state and available values.

## Blocks

- [E2-05: Implement the local graph executor](e2-05-implement-local-graph-executor.md)

## Acceptance criteria

- Every accepted invocation receives a stable run ID.
- Invalid inputs fail before a handler runs.
- Workflow-input and completed-step references resolve to the expected handler values.
- Missing, incompatible, or unavailable values produce a stable structured failure.
- Tests cover all allowed state transitions and reject invalid transitions.
