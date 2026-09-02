# E1-06: Expose workflow authoring through the Control API

| Tracking | Value |
| --- | --- |
| Status | Done |
| Last updated | 2026-08-28 |
| Picked up | Yes |
| Owner | Thomas |
| Blocked by | [E1-02](e1-02-build-control-api-foundation.md), [E1-04](e1-04-implement-workflow-library-and-validator.md), [E1-05](e1-05-build-workflow-example-validation-suite.md), [E1-07](e1-07-add-workflow-draft-version-storage.md) |

## Task

This task gives authors Control API operations that implement the lifecycle in [E1-S3](../../decisions/epic-01/e1-s3-draft-publication-lifecycle.md) as amended by [E1-S4](../../decisions/epic-01/e1-s4-interface-versioning-methodology.md):

- Validate workflow JSON without saving it; return the same findings and ordering that draft save and publication return for the same input.
- Create a draft: the server mints a workflow `id` (UUID v7), injects it into the stored document, and stores the submitted document as the draft's first revision. Any `id` in the creation payload is replaced, never honored. Later saves to a different workflow `id` are identity conflicts.
- Save and retrieve draft revisions: each successful save creates a new revision `id` (UUID v7), stores the exact bytes of the submitted document and a findings snapshot, and updates the draft's current revision. Saves carry `baseRevision` in the request body; the server commits only when it equals the current revision or returns 409 with the current revision and findings. Parse failures (invalid JSON, duplicate keys, `NaN`/`Infinity`, invalid UTF-8) are 400 errors, not drafts. Syntactically valid JSON saves despite blocking findings. Retrieval returns the stored bytes unchanged with line and column anchored to that text.
- Rewind the draft to an earlier revision: the server appends a copy of the target revision as the newest revision and makes it the current one; nothing is deleted, and rewinding to the current revision is a no-op. Authors publish earlier states by rewinding first.
- Publish the draft's current revision: re-run validation on the stored content. Blocking findings return 422 with findings and create nothing. Valid content is canonicalized (RFC 8785) and stored as an immutable published version with the next per-workflow integer version number and a SHA-256 hex digest computed over the canonical form with `name` and `description` removed. The stored content is the full canonical document, metadata members included. The response carries workflow `id`, published version number, `interfaceVersion`, and digest. Publishing the same revision again returns the existing version (idempotent via unique `(workflow_id, revision)`). No draft revisions returns 404.
- Retrieve an exact published workflow version by workflow `id` and version number.
- Select validation and publication rules from the declared `interfaceVersion` through the shared `RuleSetRegistry` (E1-S4): exact-match only, unknown versions are blocking findings, never a fallback.
- Map storage outcomes and typed errors to the E1-02 error shape in one place: outcome unions decide success, 409 (stale `baseRevision`), and 404 (`not-found`, `revision-not-found` on publish); `InvalidWorkflowInputError` → 400, `CorruptWorkflowStateError` and `DigestVerificationError` → 500 `internal_error` through the existing `onError` path. A freshly minted id colliding with an existing row is not an operationally reachable outcome, so a `DuplicateWorkflowIdError` surfaces as 500 `internal_error` rather than a client-facing 409.

> Constraint for later: when a second interface version ships, the workflow store's verification (`getPublishedVersion`) must select its rule set from the stored `interface_version` (E1-S4) instead of the single preparer created by `createWorkflowDatabase`; the registry E1-06 owns here is the wiring point. No storage change is needed while v1 is the only supported version.

Every validation and publication decision uses the shared workflow library. Published-version retrieval is byte-exact: verification is `sha256(retrieved) == digest`.

## End state

- A caller can complete the draft, validation, revision, publication, and retrieval lifecycle through the Control API, including revision checks, rewind, and digest verification.

## Why

- Human and automated authors need one API for the complete workflow-authoring lifecycle.

## Blocks

- [E1-08: Document workflow authoring for humans and agents](e1-08-publish-workflow-authoring-guidance.md)
- [E1-09: Prove draft-to-publication behavior end to end](e1-09-add-end-to-end-epic-demonstration.md)

## Acceptance criteria

- Syntactically valid JSON can be saved as a draft despite blocking workflow findings; the response carries the new revision `id` and findings.
- Every save creates a draft revision and returns its validation findings; retrieval returns the stored bytes unchanged.
- Saving from an outdated `baseRevision` fails with 409 and returns the current revision and findings without overwriting newer work.
- Draft and revision retrieval return the saved JSON and validation result; parse failures are 400, not drafts.
- Rewinding to an earlier revision appends a copy of the target as the newest revision and makes it the current one, deletes nothing, and keeps every published version's source revision retrievable.
- Publishing re-runs validation and rejects a selected revision with blocking findings (422) or with no revisions (404).
- A successful publish returns the workflow `id`, published version number, `interfaceVersion`, and digest (SHA-256 hex over canonical form with metadata excluded). Re-publishing the same current revision is idempotent.
- Storage outcomes and typed errors map to the documented statuses in the single error shape: stale `baseRevision` → 409, unknown workflow or revision → 404, invalid input → 400, storage-invariant and digest-verification failures → 500.
- The generated OpenAPI 3.1 contract (TypeBox, JSON Schema 2020-12) covers the complete lifecycle, including revision conflicts, rewind, idempotent publish, and digest reproduction; integration tests for the complete flow are a dedicated [Epic 2 task](../epic-02/e2-13-add-authoring-lifecycle-integration-tests.md).
