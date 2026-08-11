# E3-07: Add durable run Control API operations

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-05 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E3-04](e3-04-implement-retries-and-operator-controls.md), [E3-05](e3-05-implement-human-decision-waits.md), [E3-06](e3-06-add-run-timelines-and-artifacts.md) |

## Task

This task extends the Control API with operations to:

- inspect the committed run projection and step attempts;
- list decision requests and accepted responses;
- append pause, resume, and cancellation commands;
- submit a general human decision;
- retrieve ordered run events after a cursor;
- retrieve artifact metadata and content.

Read operations use the shared durable records even when the daemon is unavailable. Write operations append caller intent or a decision; they do not update execution state.

## End state

- A caller can reconnect, inspect, and control a durable run through one public API without the Control API becoming an executor.

## Why

- Durable state and controls need the same authoritative boundary used by every later client.

## Blocks

- [E3-08: Build the durable execution conformance suite](e3-08-build-durable-execution-conformance-suite.md)
- [E3-09: Document durable local runs](e3-09-publish-durable-run-guidance.md)

## Acceptance criteria

- Inspection returns the last committed run projection while the daemon is unavailable.
- Command operations return a durable request identity and distinguish request acceptance from transition completion.
- Decision submissions validate request identity, outcome, response payload, and current disposition.
- Attempt, decision, and command representations match the E3-01 contract.
- Event pagination accepts and returns opaque cursors with stable ordering.
- Artifact metadata and verified content are retrievable independently.
- API integration tests prove no operation writes or advances an execution-state projection.
