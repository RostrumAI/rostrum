# E3-S4: Define run events and artifacts

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-05 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [Epic 02](../../epics/epic-02-local-workflow-execution.md) |

## Task

This SPIKE defines the records used to inspect a run after reconnecting. It answers:

- Which committed changes produce run events?
- How are events ordered within a run and retrieved after a cursor?
- Which event fields remain stable across API and storage implementations?
- What identifies an artifact and its producing run, step, and attempt?
- Which metadata and digest make artifact content verifiable?
- How are incomplete artifact writes and missing or corrupt content represented?
- Which local storage boundary can later be replaced without changing the Control API?

## End state

- One reviewed event and artifact contract plus replay and integrity fixtures define durable run inspection.

## Why

- Reconnecting clients need a stable timeline and independently retrievable evidence rather than process-local logs.

## Blocks

- [E3-01: Specify durable execution behavior and fixtures](e3-01-specify-durable-execution-behavior.md)

## Acceptance criteria

- Each committed event has an immutable per-run sequence and stable structured shape.
- Cursor examples prove ordered pagination without gaps or duplicates.
- Live subscription is not required by the contract.
- Artifact metadata includes identity, producer, name, media type, size, digest, and creation time.
- Artifact content is immutable and independently retrievable by ID.
- Incomplete, missing, corrupt, and digest-mismatched content have defined results.
- Retention, deletion, remote object storage, and cloud tenancy remain outside the decision.
