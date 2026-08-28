# E2-12: Prove local execution end to end

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-28 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-11](e2-11-build-execution-conformance-suite.md) |

## Task

This task delivers a repeatable end-to-end demonstration of the complete Epic 02 runtime and a verified local execution guide.

A single command executes the following workflow:

1. Starts the Control API (the HTTP service that accepts workflow invocations, publishes workflow definitions, and queries run state) and the daemon (the background execution service) as separate processes.
2. Publishes representative workflow interface v1 documents (the version 1 schema and runtime specification for Rostrum workflows).
3. Invokes exact published workflow versions through the Control API.
4. Disconnects invoking clients immediately after the API accepts the invocation request.
5. Retrieves active step status and terminal run results.
6. Tests invocation rejection and failures during accepted runs.
7. Stops both processes cleanly.

The demonstration covers sequential data flow, both branches of conditional steps, parallel paths with a join step, bounded loops, error-tolerant loops, invalid invocation requests, invalid handler outputs, and concurrent handler failures.

The local execution guide uses the same commands and explains observable run states, `currentSteps` (the run state property that lists currently executing step identifiers), step outputs, failure fields, in-memory execution boundaries, supported reference steps, parallel joins, and loop policies.

## End state

A contributor can run one documented command to observe Rostrum executing the complete workflow interface v1 control flow across the separate Control API and daemon processes.

## Why

Unit and conformance tests verify individual contracts. The epic requires a final demonstration to prove that the independently running processes interact correctly and that you can run the documented workflows without test helpers.

## Acceptance criteria

- The daemon and Control API start as separate processes.
- A sequential workflow passes data across multiple steps and returns the declared result.
- Separate conditional runs prove each destination and skip the other path.
- A parallel workflow proves bounded dispatch and matching-join behavior.
- Loop demonstrations prove collection-order execution and captured error results.
- Invalid invocation fails before run creation.
- Invalid handler output fails the accepted run with the documented output error.
- Concurrent handler failures stop new work, drain active work, and return the complete ordered failure list.
- At least one run completes after its invoking client disconnects.
- The guide explains every command and the specific output that you should inspect.
- One continuous-integration command runs the demonstration and the documentation examples without timing-dependent polling.
