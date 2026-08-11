# E3-06: Add run timelines and artifacts

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-05 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E3-02](e3-02-implement-durable-run-storage.md) |

## Task

This task creates the durable records used to inspect execution evidence. It adds:

- immutable, per-run event sequences for every specified transition;
- ordered pagination after an opaque cursor;
- local immutable artifact content storage;
- artifact metadata, producer references, and digest verification;
- a reference handler outcome that emits a small deterministic artifact;
- stable failures for incomplete, missing, corrupt, or mismatched artifact content.

## End state

- A caller can reconstruct the committed run timeline and retrieve verifiable artifacts after reconnecting.

## Why

- Durable execution needs inspectable history and evidence that do not depend on process-local logs or a live client connection.

## Blocks

- [E3-07: Add durable run Control API operations](e3-07-add-durable-run-control-api-operations.md)
- [E3-08: Build the durable execution conformance suite](e3-08-build-durable-execution-conformance-suite.md)

## Acceptance criteria

- Events use an immutable sequence that increases monotonically within each run.
- State changes and their required events cannot commit independently.
- Cursor pagination returns stable ordered pages without gaps or duplicates.
- Artifact metadata includes every field required by E3-S4 and refers to immutable content.
- Retrieval verifies the recorded byte size and digest.
- The fixture handler emits the documented artifact and relates it to the correct attempt.
- Tests cover incomplete writes, missing content, corruption, and digest mismatch.
