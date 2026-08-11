# E3-05: Implement human-decision waits

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-05 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E3-02](e3-02-implement-durable-run-storage.md), [E3-03](e3-03-recover-interrupted-runs.md) |

## Task

This task implements the general human-decision step defined by E3-S3. It:

- validates declared outcomes and the optional response schema;
- creates one durable request when the step executes;
- moves the run into its decision wait without retaining an active handler;
- accepts one valid response through the durable decision record;
- selects the declared continuation and binds response data;
- rejects duplicate, invalid, late, and conflicting submissions as specified.

## End state

- A workflow can wait across client and daemon interruption, accept a general decision, and continue through the selected path.

## Why

- Human participation must be a durable workflow operation rather than a client session or blocked handler.

## Blocks

- [E3-07: Add durable run Control API operations](e3-07-add-durable-run-control-api-operations.md)
- [E3-08: Build the durable execution conformance suite](e3-08-build-durable-execution-conformance-suite.md)

## Acceptance criteria

- The decision step is registered, validated, and executed through the shared handler and graph contracts.
- Entering the wait commits exactly one request with its run and step identity.
- Daemon restart does not duplicate the request or advance the waiting run.
- A valid selected outcome follows only its declared connection.
- A valid response payload is available to downstream bindings.
- Duplicate, invalid, late, and conflicting submissions match the approved fixtures.
- Operator resume cannot bypass the decision wait.
