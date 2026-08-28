# E2-12: Prove local execution end to end

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-28 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-11](e2-11-build-execution-conformance-suite.md) |

## Task

This task creates one repeatable proof of the complete Epic 02 product state and the tested guide for running it.

One command:

1. Starts the Control API and daemon as separate processes.
2. Publishes representative workflow interface v1 documents.
3. Invokes exact published versions through the Control API.
4. Disconnects invoking clients after acceptance.
5. Retrieves current work and terminal results.
6. Exercises invocation rejection and accepted-run failures.
7. Stops both processes cleanly.

The demonstration includes sequential data flow, both conditional destinations, parallel paths with a join, a bounded loop, an error-tolerant loop, invalid invocation, invalid handler output, and concurrent failures.

The local-run guide uses the same commands and explains the observable run states, `currentSteps`, outputs, failure fields, in-memory boundary, supported reference steps, parallel joins, and loop policies.

## End state

A contributor can run one documented command and observe Rostrum executing the complete workflow interface v1 control flow through the real Control API and daemon boundary.

## Why

Unit and conformance tests prove individual contracts. The Epic needs one final demonstration that the separately running applications work together and that the documented workflow can be reproduced outside a test helper.

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
- The guide explains every command and the output a reader should inspect.
- One continuous-integration command runs the demonstration and the documentation examples without timing-dependent polling.
