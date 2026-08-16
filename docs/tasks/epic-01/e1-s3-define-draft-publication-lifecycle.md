# E1-S3: Decide how drafts become published versions

| Tracking | Value |
| --- | --- |
| Status | Proposed — awaiting approval |
| Last updated | 2026-08-16 |
| Picked up | Yes |
| Owner | Thomas |
| Blocked by | None |

## Task

Decisions made so far are recorded in [Decision e1-s3: Draft revision and publication lifecycle](../../decisions/epic-01/e1-s3-draft-publication-lifecycle.md).

This SPIKE decides how workflow JSON moves from incomplete work to an immutable version. It answers:

- Which workflow, draft, revision, and published-version identifiers exist?
- When does each identifier change?
- How is incomplete JSON saved, retrieved, and revised safely?
- How does an author select a revision for publication?
- What happens on repeated publication or a version conflict?
- How is published JSON normalized and hashed?
- What happens to a draft after publication?

## End state

- One lifecycle decision record and digest fixture set define draft revision and publication behavior.

## Why

- Authors need resumable drafts, and callers need an exact published version they can retrieve and verify.

## Blocks

- [E1-03: Specify workflow JSON and its lifecycle](e1-03-write-workflow-interface-v1-specification.md)
- [E1-07: Persist workflow drafts and published versions](e1-07-add-workflow-draft-version-storage.md)

## Acceptance criteria

- A reviewed decision record defines each identifier and when it changes.
- Syntactically valid JSON can be saved as a draft despite blocking workflow findings.
- Each save creates a revision and uses a revision check to prevent silent overwrites.
- Publishing a selected valid revision creates an immutable version without removing the draft.
- Repeated publication and version conflicts have defined results.
- Shared test vectors reproduce the same published digest across intended implementations.
