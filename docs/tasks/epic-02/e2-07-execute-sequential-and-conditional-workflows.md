# E2-07: Execute sequential and conditional workflows

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-28 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-04](e2-04-make-workflow-interface-v1-executable.md), [E2-05](e2-05-build-local-daemon.md), [E2-06](e2-06-build-step-interface-and-reference-steps.md) |

## Task

This task builds the common in-memory execution engine and proves sequential and conditional workflows inside the daemon.

It performs these operations:

- verify the exact published workflow version, digest, interface version, registered step handlers (components that execute step logic), and invocation inputs before accepting a run;
- prepare and cache the immutable workflow information needed during execution;
- create a run ID and in-memory run state;
- track pending, waiting, running, succeeded, failed, and unselected step instances (instances bypassed by conditional evaluation);
- resolve workflow inputs and committed step outputs;
- invoke step handlers and commit only validated outputs;
- follow sequential connections;
- evaluate declared conditional expressions and activate one destination;
- bind the final output at an explicit `result` step;
- expose waiting and running step instances through `currentSteps`;
- retain structured failures and prevent a failed run from becoming successful.

The daemon owns execution after acceptance. The client connection has no role in advancing the run.

## End state

The daemon executes every sequential and conditional E2-03 fixture from invocation to a declared result or structured failure.

## Why

This task establishes the execution behavior shared by parallel paths and loops without hiding it behind the Control API.

## Blocks

- [E2-08: Execute parallel paths and joins](e2-08-execute-parallel-paths-and-joins.md)

## Acceptance criteria

- Missing or undeclared inputs, incompatible input values, unsupported interface versions, digest mismatches, and unavailable step handlers reject invocation without creating a run.
- Every accepted invocation receives a stable run ID and begins independently of the caller connection.
- Sequential fixtures execute each selected step once and in order.
- The engine evaluates conditionals by the documented operator and priority rules; handlers never return branch names.
- Unselected conditional paths never run and remain distinguishable from failures.
- Step outputs become visible to downstream bindings only after successful validation and commit.
- `currentSteps` reports waiting and running instances in the documented order and is empty for queued and terminal runs.
- Only an explicit `result` step can complete a run successfully.
- Unit and daemon integration tests cover every state transition and reject invalid transitions.
