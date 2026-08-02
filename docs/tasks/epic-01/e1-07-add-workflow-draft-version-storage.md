# E1-07: Persist workflow drafts and published versions

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-S0](e1-s0-select-implementation-stack.md), [E1-S3](e1-s3-define-draft-publication-lifecycle.md), [E1-06](e1-06-add-control-api-workflow-operations.md) |

## Task

This task implements the database or equivalent store selected by E1-S0. It adds:

- schemas and migrations for drafts, revisions, validation results, and published versions;
- storage for workflow JSON, identifiers, interface versions, digests, and creation metadata;
- transactional revision checks that prevent silent overwrites;
- immutable published-version records;
- data access used by the Control API to retrieve drafts, revisions, and published versions.

## End state

- Drafts and published workflow versions remain retrievable and correct after the Control API restarts.

## Why

- Workflow authoring and execution require durable definitions with enforced revision and immutability rules.

## Blocks

- [E1-09: Prove draft-to-publication behavior end to end](e1-09-add-end-to-end-epic-demonstration.md)

## Acceptance criteria

- Schema migrations create and update the required storage safely.
- Drafts, their revisions, findings, and published workflows remain available after a Control API restart.
- Draft retrieval returns the selected revision unchanged.
- Revision checks prevent an older draft state from overwriting newer work.
- Published versions cannot be changed or deleted through draft operations.
- Editing a draft after publication leaves the published version unchanged.
- Integration tests cover persistence, revision conflicts, publication, immutability, and digest reproduction.
