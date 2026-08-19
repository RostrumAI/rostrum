# E1-07: Persist workflow drafts and published versions

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-19 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-S0](e1-s0-select-implementation-stack.md), [E1-S3](e1-s3-define-draft-publication-lifecycle.md), [E1-06](e1-06-add-control-api-workflow-operations.md) |

## Task

This task implements the Postgres store selected by [E1-S0](../../decisions/epic-01/e1-s0-implementation-stack.md) using postgres.js with Kysely and SQL-file migrations. It adds:

- Schemas and migrations for drafts, revisions, validation results, and published versions. Revisions store the server-assigned `id` (UUID v7), exact submitted bytes, findings snapshot, and optional name. Published versions store the RFC 8785 canonical text and SHA-256 hex digest (computed over the canonical form with `name` and `description` removed, per [E1-S4](../../decisions/epic-01/e1-s4-interface-versioning-methodology.md)).
- Storage for workflow JSON, identifiers, interface versions, digests, and creation metadata (`createdAt`/`updatedAt`).
- Transactional revision checks that prevent silent overwrites: one transaction inserts the revision row and conditionally updates `workflows.current_revision` where `current_revision = baseRevision` (no row means 409). Unique index on `(workflow_id, revision)` backstops idempotent publish; revision `id` values are server-minted UUID v7.
- Immutable published-version records with per-workflow monotonic integer version numbers and unique `(workflow_id, revision)` — a revision publishes at most once; concurrent publishes of the same revision return the same single version via the unique-index race.
- Rewind semantics: setting the current revision to an earlier revision and deleting newer revisions, refusing rewind past the newest published revision's source so every published version's source revision remains retrievable.
- Digest verification: recomputed `sha256(retrieved canonical bytes) == digest` over definitional content (metadata excluded).
- Data access used by the Control API to retrieve drafts, revisions, and published versions, including byte-exact draft retrieval and canonical published retrieval that survive Control API restarts.

Local development uses the Docker Compose Postgres service via `DATABASE_URL`. Migrations run programmatically and safely in tests.

## End state

- Drafts and published workflow versions remain retrievable and byte-correct after the Control API restarts.

## Why

- Workflow authoring and execution require durable definitions with enforced revision and immutability rules.

## Blocks

- [E1-09: Prove draft-to-publication behavior end to end](e1-09-add-end-to-end-epic-demonstration.md)

## Acceptance criteria

- Schema migrations create and update the required storage safely, including idempotent reruns.
- Drafts, their revisions, findings, and published workflows remain available after a Control API restart.
- Draft retrieval returns the selected revision bytes unchanged; findings' line and column remain anchored to the stored text.
- Revision checks prevent an older draft state from overwriting newer work; stale `baseRevision` returns 409 with the current revision and findings.
- Rewind marks the target as current, deletes newer revisions, and refuses a target older than the newest published revision's source.
- Published versions cannot be changed or deleted through draft operations; they are immutable rows with per-workflow integer versions.
- Editing a draft after publication leaves the published version byte-unchanged.
- Metadata-only edits leave the digest unchanged; digest reproduction from the stored canonical bytes matches the stored digest.
- Integration tests cover persistence, revision conflicts, rewind, publication, immutability, and digest reproduction, including the idempotent concurrent-publish race.
