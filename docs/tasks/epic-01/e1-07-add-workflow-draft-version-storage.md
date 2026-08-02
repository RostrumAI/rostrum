# E1-07: Add workflow draft and version storage

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-S3](e1-s3-define-draft-publication-lifecycle.md), [E1-06](e1-06-add-control-api-workflow-operations.md) |

## Task

- Add persistent storage and migrations for drafts, draft revisions, validation results, and published workflow versions.
- Store the JSON, workflow and draft identifiers, interface version, revision or published version, digest, and creation metadata.
- Enforce draft revision checks and immutable published versions.

## Why

- Authors must be able to resume incomplete work, and callers must be able to retrieve the exact workflow Rostrum published after the Control API restarts.

## Blocks

- [E1-09: Add the end-to-end Epic demonstration](e1-09-add-end-to-end-epic-demonstration.md)

## Acceptance criteria

- Schema migrations create and update the required storage safely.
- Drafts, their revisions, findings, and published workflows remain available after a Control API restart.
- Draft retrieval returns the selected revision unchanged.
- Revision checks prevent an older draft state from overwriting newer work.
- Published versions cannot be changed or deleted through draft operations.
- Editing a draft after publication leaves the published version unchanged.
- Integration tests cover persistence, revision conflicts, publication, immutability, and digest reproduction.

