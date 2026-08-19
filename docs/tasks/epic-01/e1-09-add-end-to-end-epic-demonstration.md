# E1-09: Prove draft-to-publication behavior end to end

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-19 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-06](e1-06-add-control-api-workflow-operations.md), [E1-07](e1-07-add-workflow-draft-version-storage.md), [E1-08](e1-08-publish-workflow-authoring-guidance.md) |

## Task

This task creates one repeatable proof of the complete Epic 1 product state. It:

- Saves and retrieves an incomplete draft — server-assigned workflow `id` (UUID v7), new revision `id` (UUID v7), exact bytes stored, findings returned.
- Revises the draft from validation findings (`code`, `details`, `path`, `relatedLocations`) and confirms the new revision validates.
- Proves that a stale `baseRevision` cannot overwrite newer work: the stale save returns 409 with the current revision and findings, and no partial write occurs.
- Proves rewind-then-publish: rewind the draft to an earlier revision (newer revisions deleted, draft shows target content), then publish the current revision.
- Proves idempotent repeat publish: publishing the same current revision again returns the existing version without creating a new one; concurrent publishes of the same revision return the same single version.
- Proves metadata-only edits leave the digest unchanged: edit `name` or `description` alone, republish, and confirm the digest equals the previous version's digest.
- Publishes a valid current revision (re-validation, 422 on blocking findings otherwise).
- Restarts the Control API.
- Retrieves the unchanged draft revision bytes and the published version canonical bytes.
- Reproduces the published digest: `sha256(RFC 8785 canonical form with metadata members removed) == stored digest`.
- Runs from one documented command in continuous integration.

## End state

- One release gate proves that workflow JSON can move from an incomplete draft to a durable, immutable published version with correct revision checks, rewind, idempotent publish, and digest rules.

## Why

- Individual tests need one end-to-end counterpart that proves the assembled product state.

## Blocks

- Epic 02: Local workflow execution

## Acceptance criteria

- The demonstration saves and retrieves an incomplete draft with the expected findings.
- An outdated `baseRevision` save fails with 409 without overwriting newer work.
- Rewind makes an earlier revision the current revision, deletes newer revisions, and allows publication of that state.
- Re-publishing the same current revision is idempotent and concurrent publishes of the same revision return the same version.
- A corrected revision validates and publishes successfully; the response carries workflow `id`, published version number, `interfaceVersion`, and digest.
- A metadata-only edit followed by republish yields the same digest as the prior version.
- The draft and published workflow remain retrievable and byte-correct after the Control API restarts.
- Editing the draft after publication leaves the published version unchanged.
- The retrieved published JSON produces the stored digest using RFC 8785 canonicalization with metadata excluded.
- The demonstration runs from one documented command and passes in continuous integration.
