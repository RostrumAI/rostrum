# E3-08: Build the durable execution conformance suite

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-05 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E3-03](e3-03-recover-interrupted-runs.md), [E3-04](e3-04-implement-retries-and-operator-controls.md), [E3-05](e3-05-implement-human-decision-waits.md), [E3-06](e3-06-add-run-timelines-and-artifacts.md), [E3-07](e3-07-add-durable-run-control-api-operations.md) |

## Task

This task turns the E3-01 fixtures into automated conformance tests. The suite verifies:

- each documented daemon interruption point;
- committed-progress recovery and interrupted-attempt handling;
- bounded retry success and exhaustion;
- urgent cooperative pause, resume, cancellation, and command conflicts;
- human-decision waiting, restart, submission, and branching;
- cursor-based event replay and artifact integrity;
- consistent records across the runtime, durable store, daemon, and Control API.

## End state

- Continuous integration detects any durable lifecycle behavior that disagrees with the approved fixtures.

## Why

- Restart and race behavior cannot be established by ordinary successful-run tests alone.

## Blocks

- [E3-09: Document durable local runs](e3-09-publish-durable-run-guidance.md)
- [E3-10: Prove durable runs and human control end to end](e3-10-add-end-to-end-epic-demonstration.md)

## Acceptance criteria

- Every E3-01 fixture has expected state, attempts, commands, decisions, events, and artifacts.
- Tests stop and restart real daemon processes at each required checkpoint boundary.
- Retry and control races assert the approved precedence and final disposition.
- Event assertions prove monotonic sequence and gap-free cursor replay.
- Artifact assertions verify metadata, content, size, digest, and producer identity.
- API tests run while the daemon is unavailable and prove execution state remains unchanged.
- The complete suite runs in continuous integration.
