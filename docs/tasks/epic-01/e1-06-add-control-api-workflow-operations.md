# E1-06: Expose workflow authoring through the Control API

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-02 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E1-02](e1-02-build-control-api-foundation.md), [E1-04](e1-04-implement-workflow-library-and-validator.md), [E1-05](e1-05-build-workflow-example-validation-suite.md) |

## Task

This task gives authors Control API operations to:

- validate workflow JSON without saving it;
- create a draft;
- save and retrieve draft revisions;
- publish a selected valid revision;
- retrieve an exact published workflow version.

Every validation and publication decision uses the shared workflow library.

## End state

- A caller can complete the draft, validation, revision, publication, and retrieval lifecycle through the Control API.

## Why

- Human and automated authors need one API for the complete workflow-authoring lifecycle.

## Blocks

- [E1-07: Persist workflow drafts and published versions](e1-07-add-workflow-draft-version-storage.md)
- [E1-08: Document workflow authoring for humans and agents](e1-08-publish-workflow-authoring-guidance.md)
- [E1-09: Prove draft-to-publication behavior end to end](e1-09-add-end-to-end-epic-demonstration.md)

## Acceptance criteria

- Syntactically valid JSON can be saved as a draft despite blocking workflow findings.
- Every save creates a draft revision and returns its validation findings.
- Saving from an outdated revision fails with a documented conflict.
- Draft and revision retrieval return the saved JSON and validation result.
- Publishing reruns validation and rejects a selected revision with blocking findings.
- A successful publish returns the workflow ID, published version, interface version, and digest.
- The generated API contract and integration tests cover the complete lifecycle.
