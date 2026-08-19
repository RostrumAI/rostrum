# E1-06: Expose workflow authoring through the Control API

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-19 |
| Picked up | Yes |
| Owner | Thomas |
| Blocked by | [E1-02](e1-02-build-control-api-foundation.md), [E1-04](e1-04-implement-workflow-library-and-validator.md), [E1-05](e1-05-build-workflow-example-validation-suite.md), [E1-07](e1-07-add-workflow-draft-version-storage.md) |

## Task

This task gives authors Control API operations that implement the lifecycle in [E1-S3](../../decisions/epic-01/e1-s3-draft-publication-lifecycle.md) as amended by [E1-S4](../../decisions/epic-01/e1-s4-interface-versioning-methodology.md):

- Validate workflow JSON without saving it; return the same findings and ordering that draft save and publication return for the same input.
- Create a draft: the server mints a workflow `id` (UUID v7) and injects it into the stored document. Any `id` in the creation payload is replaced, never honored. Later saves to a different workflow `id` are identity conflicts.
- Save and retrieve draft revisions: each successful save creates a new revision `id` (UUID v7), stores the exact submitted bytes and a findings snapshot, and updates the draft's current revision. Saves carry `baseRevision`; the server commits only when it equals the current revision or returns 409 with the current revision and findings. Parse failures (invalid JSON, duplicate keys, `NaN`/`Infinity`, invalid UTF-8) are 400 errors, not drafts. Syntactically valid JSON saves despite blocking findings. Retrieval returns the stored bytes unchanged with line and column anchored to that text.
- Rewind the draft to an earlier revision: the target becomes the current revision and newer revisions are deleted. Rewinding past the newest published revision's source is refused. Authors publish earlier states by rewinding first.
- Publish the draft's current revision: re-run validation on the stored content. Blocking findings return 422 with findings and create nothing. Valid content is canonicalized (RFC 8785 with `name` and `description` removed) and stored as an immutable published version with the next per-workflow integer version number and SHA-256 hex digest. The stored content is the full canonical document. The response carries workflow `id`, published version number, `interfaceVersion`, and digest. Publishing the same revision again returns the existing version (idempotent via unique `(workflow_id, revision)`). No draft revisions returns 404.
- Retrieve an exact published workflow version by workflow `id` and version number.

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
- Rewinding to an earlier revision makes it the current revision, deletes newer revisions, and refuses targets older than the newest published revision's source.
- Publishing re-runs validation and rejects a selected revision with blocking findings (422) or with no revisions (404).
- A successful publish returns the workflow `id`, published version number, `interfaceVersion`, and digest (SHA-256 hex over canonical form with metadata excluded). Re-publishing the same current revision is idempotent.
- The generated OpenAPI 3.1 contract (TypeBox, JSON Schema 2020-12) and integration tests cover the complete lifecycle, including revision conflicts, rewind, idempotent publish, and digest reproduction.
