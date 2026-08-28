# E2-10: Expose runs through the Control API

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-28 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-09](e2-09-execute-bounded-loops.md) |

## Task

This task exposes two Control API operations to callers. The Control API is the caller-facing API boundary:

1. Start a run for an exact published workflow version and structured inputs.
2. Retrieve the run's current representation or its terminal representation, the representation after the run reaches a final state.

To start a run, the Control API resolves the requested immutable workflow version. It then sends the invocation, a request to start a workflow run, through the E2-S2 transport. The transport carries the invocation to the daemon, the background process. The API returns the daemon's acceptance or rejection. It does not execute workflow steps or make routing decisions.

The run representation includes:

- run and workflow identity;
- exact published version;
- public run status;
- ordered `currentSteps` for waiting and running work;
- final output for a successful run;
- complete ordered failures for a failed run.

## End state

A caller can start and inspect any supported local workflow run without connecting directly to the daemon or keeping the invocation connection open.

## Why

The Control API is the single caller boundary for local and later hosted execution. Keeping graph logic in the daemon preserves that boundary as durability and remote workers are added.

## Blocks

- [E2-11: Build the execution conformance suite](e2-11-build-execution-conformance-suite.md)

## Acceptance criteria

- A valid request names an exact published workflow version and returns `HTTP 201` with a run ID and `queued` representation.
- A request with an invalid workflow identity, input, interface support, digest (the workflow-content verification value), or handler availability (whether the executable unit for a workflow step is available) returns the documented rejection and no run ID.
- The invocation connection can close immediately after acceptance without stopping the run.
- Retrieval returns the documented `queued`, `running`, `succeeded`, or `failed` representation.
- A run remains publicly `running` while already-started handlers drain after an unhandled failure.
- `currentSteps` matches the daemon projection (the daemon-generated view of run state) and is empty for `queued` and terminal runs.
- `succeeded` runs return output and an empty failure list; `failed` runs return no output and the complete ordered failure list.
- Unknown runs and unavailable daemon behavior match the public error contract.
- API integration tests prove that no graph or handler logic executes inside the Control API process.
